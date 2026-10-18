import { randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "arl_operator";
const TTL = 15 * 60 * 1000;
const LIMIT = 16384;
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
type Options = {
  mode?: () => "fixture" | "live";
  secret: () => string;
  origin: () => string;
  proxy: (path: string, method: string, body?: unknown) => Promise<Response>;
  clock?: () => number;
};
/** Browser-only adapter. The bearer-authenticated lab API remains origin-denying. */
export function createOperatorHandler(options: Options) {
  const sessions = new Map<string, { csrf: string; expires: number }>();
  const clock = options.clock ?? Date.now;
  let failedLogins = 0,
    loginWindow = 0;
  return async (request: Request): Promise<Response> => {
    const nonce = randomBytes(18).toString("base64");
    const headers = new Headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    });
    const json = (data: unknown, status = 200) => {
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(data), { status, headers });
    };
    try {
      const url = new URL(request.url),
        origin = options.origin();
      if (
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
        (request.headers.get("host") ?? url.host) !== new URL(origin).host
      )
        return json({ error: "request_denied" }, 403);
      for (const [key, session] of sessions)
        if (session.expires <= clock()) sessions.delete(key);
      if (
        request.method === "GET" &&
        ["/operator", "/operator/"].includes(url.pathname)
      ) {
        headers.set("content-type", "text/html; charset=utf-8");
        return new Response(page(nonce, options.mode?.() ?? "fixture"), {
          headers,
        });
      }
      if (
        ["cross-site", "same-site"].includes(
          request.headers.get("sec-fetch-site") ?? "",
        )
      )
        return json({ error: "request_denied" }, 403);
      if (request.method !== "GET" && request.headers.get("origin") !== origin)
        return json({ error: "origin_denied" }, 403);
      let body: unknown;
      if (request.method === "POST") {
        if (request.headers.get("content-type") !== "application/json")
          return json({ error: "json_required" }, 415);
        const reader = request.body?.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        if (!reader) return json({ error: "invalid_body" }, 400);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > LIMIT) {
            await reader.cancel();
            return json({ error: "body_too_large" }, 413);
          }
          chunks.push(value);
        }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      if (request.method === "POST" && url.pathname === "/operator/login") {
        if (clock() - loginWindow >= 60_000) {
          failedLogins = 0;
          loginWindow = clock();
        }
        if (failedLogins >= 10)
          return json({ error: "login_rate_limited" }, 429);
        if (
          !body ||
          typeof body !== "object" ||
          Object.keys(body).join() !== "secret" ||
          typeof (body as { secret: unknown }).secret !== "string" ||
          !equal((body as { secret: string }).secret, options.secret())
        ) {
          failedLogins++;
          return json({ error: "login_denied" }, 403);
        }
        failedLogins = 0;
        if (sessions.size >= 32) return json({ error: "session_limit" }, 429);
        const id = randomBytes(32).toString("hex"),
          csrf = randomBytes(32).toString("hex");
        sessions.set(id, { csrf, expires: clock() + TTL });
        headers.set(
          "set-cookie",
          `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=900`,
        );
        return json({ csrf, expiresInSeconds: 900 });
      }
      const id = request.headers
        .get("cookie")
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);
      const session = id ? sessions.get(id) : undefined;
      if (!session) return json({ error: "login_required" }, 401);
      if (request.method === "GET" && url.pathname === "/operator/session")
        return json({ csrf: session.csrf });
      if (
        request.method !== "GET" &&
        !equal(request.headers.get("x-csrf-token") ?? "", session.csrf)
      )
        return json({ error: "csrf_denied" }, 403);
      if (request.method === "POST" && url.pathname === "/operator/logout") {
        sessions.delete(id!);
        headers.set(
          "set-cookie",
          `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/operator; Max-Age=0`,
        );
        return json({ loggedOut: true });
      }
      const suffix = url.pathname.slice("/operator/api".length);
      const allowed =
        url.pathname.startsWith("/operator/api/") &&
        !url.search &&
        ((request.method === "GET" &&
          /^\/runs(?:\/[A-Za-z0-9_-]{1,128})?$/.test(suffix)) ||
          (request.method === "POST" &&
            (/^\/runs(?:\/[A-Za-z0-9_-]{1,128}\/(approve|reject|cancel|resume))?$/.test(
              suffix,
            ) ||
              suffix === "/namespaces/reset")));
      if (!allowed) return json({ error: "route_denied" }, 404);
      const upstream = await options.proxy(
        `/lab${suffix}`,
        request.method,
        body,
      );
      headers.set("content-type", "application/json");
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers,
      });
    } catch {
      return json({ error: "request_failed" }, 400);
    }
  };
}

function page(nonce: string, mode: "fixture" | "live") {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent Reliability Lab · Operator</title>
<style nonce="${nonce}">:root{font-family:system-ui,sans-serif;color:#193042;background:#eef3f4;font-size:15px}*{box-sizing:border-box}body{margin:0}header{background:#112d37;color:#fff;padding:24px 5vw;display:flex;justify-content:space-between;align-items:center;gap:20px}h1{font-size:24px;margin:4px 0}h2{font-size:18px}h3{font-size:15px}p{line-height:1.6}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#92d8d0}.badge{border:1px solid #7cb2ad;border-radius:30px;padding:6px 12px;font-size:12px}main{max-width:1400px;margin:30px auto;padding:0 4vw}.card{background:#fff;border:1px solid #d9e2e4;border-radius:12px;padding:22px;margin-bottom:18px;box-shadow:0 4px 15px #122c3705}.layout{display:grid;grid-template-columns:320px minmax(0,1fr);gap:22px}.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}button,input{font:inherit;border-radius:7px;border:1px solid #b6c7cb;padding:10px 13px}button{cursor:pointer;background:#f5f8f8;color:#173844}button.primary{background:#146c62;color:#fff;border-color:#146c62}button.danger{color:#9e302d}button:disabled{opacity:.45;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:3px solid #d19e35;outline-offset:3px}.run{display:block;text-align:left;width:100%;margin:8px 0;overflow-wrap:anywhere}.run[aria-current=true]{border-color:#146c62;background:#edf8f5}small,.muted{color:#5b6d78}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f8f9;padding:14px;border-radius:7px;font-size:12px;line-height:1.6;max-height:420px;overflow:auto}.notice{border-left:4px solid #c68c2d;padding:10px 15px;background:#fff7e7}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}label{display:block;margin:12px 0 6px}input{max-width:100%;width:500px}#login{max-width:560px;margin:60px auto}#status{min-height:24px;margin:12px 0;color:#354e5a}ol{padding-left:20px}li{margin:10px 0;overflow-wrap:anywhere}.hidden{display:none!important}@media(max-width:800px){.layout,.grid{grid-template-columns:1fr}header{align-items:flex-start}main{padding:0 16px}.card{padding:16px}}</style>
<header><div><div class="eyebrow">Local operations / Synthetic evidence</div><h1>Agent Reliability Lab</h1></div><span class="badge">${mode === "live" ? "Live configured · inspect completed calls" : "Fixture mode · no paid model calls"}</span></header><main>
<section id="login" class="card"><h2>Operator sign in</h2><p>Run npm run lab -- operator-secret locally, then paste its output here. The browser keeps a short-lived session cookie; the secret is never saved in browser storage.</p><form id="loginForm"><label for="secret">Local operator secret</label><input id="secret" type="password" required autocomplete="off"><p><button class="primary">Sign in</button></p></form></section>
<div id="workspace" class="hidden"><div class="bar"><p class="muted">A deterministic workflow. An independent service. Decisions you can inspect.</p><button id="logout">Sign out</button></div><div class="layout"><aside><section class="card"><div class="bar"><h2>Runs</h2><button id="refresh">Refresh</button></div><details><summary>Limits for the next run</summary><p class="muted">Lower a limit before starting. Limits are immutable once a run begins.</p><label for="limit-modelTurns">Model turns (1–5)</label><input id="limit-modelTurns" type="number" min="1" max="5" value="5"><label for="limit-toolCalls">Tool calls (1–8)</label><input id="limit-toolCalls" type="number" min="1" max="8" value="8"><label for="limit-activeMs">Active time, milliseconds (1–120000)</label><input id="limit-activeMs" type="number" min="1" max="120000" value="120000"><label for="limit-requestedModelTokens">Requested tokens (1–8000)</label><input id="limit-requestedModelTokens" type="number" min="1" max="8000" value="8000"><label for="limit-readAttempts">Read attempts (1–3)</label><input id="limit-readAttempts" type="number" min="1" max="3" value="3"></details><p><button id="newRun" class="primary">Start synthetic run</button></p><div id="runs"></div></section><section class="card"><h3>Dataset namespace</h3><p class="muted">Start a fresh logical namespace. Previous runs and evidence remain available.</p><button id="reset">New namespace</button><pre id="namespace">Loading…</pre></section></aside><article id="detail" class="card"><h2>Select a run</h2><p>Start a run, inspect its proposal, then explicitly approve or reject the exact action.</p></article></div></div><p id="status" role="status" aria-live="polite"></p></main>
<script nonce="${nonce}">
const $=id=>document.getElementById(id);let csrf='',selected='',current=null,busy=false;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
function status(message){$('status').textContent=message}
async function api(path,body){const response=await fetch('/operator/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','x-csrf-token':csrf},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',redirect:'error'});const data=await response.json();if(!response.ok){if(response.status===401)showLogin();throw Error(data.error||'Request failed')}return data}
function showLogin(){$('login').classList.remove('hidden');$('workspace').classList.add('hidden');csrf=''}
function showWorkspace(){$('login').classList.add('hidden');$('workspace').classList.remove('hidden')}
async function refresh(){const data=await api('api/runs');$('runs').replaceChildren();$('namespace').textContent=JSON.stringify(data.namespace??data.activeNamespace??'Current local dataset',null,2);for(const run of [...data.runs].reverse()){const b=node('button',run.state+' · '+run.runId,'run');b.setAttribute('aria-current',String(run.runId===selected));b.onclick=()=>act(async()=>{selected=run.runId;await refresh()});$('runs').append(b)}if(selected){const detail=await api('api/runs/'+encodeURIComponent(selected));current=detail.run;render(detail)}}
function section(title,value){const s=node('section');s.append(node('h3',title),node('pre',JSON.stringify(value??'Not available',null,2)));return s}
function render(data){const r=data.run,d=$('detail');d.replaceChildren();const top=node('div',undefined,'bar');top.append(node('h2','Run evidence'),node('span',r.state,'badge'));d.append(top,node('p',r.runId,'muted'));if(r.intent)d.append(node('p','Dispatch intent accepted. Cancellation requests cannot promise rollback. Reconciliation checks the service receipt before another write.','notice'));if(r.error)d.append(node('p','Outcome: '+r.error,'notice'));const grid=node('div',undefined,'grid');grid.append(section('Usage',r.usage??r.budget??{toolCalls:r.toolCalls,reapprovals:r.reapprovals}),section('Limits',r.limits??data.limits??{}));d.append(grid,node('p','Source: '+(r.sourceMode??'fixture')+'. Requested tokens and cost reservations are preventive estimates. Actual usage is shown only when reported by the provider.','muted'),section('Proposal · review before approval',r.proposal));if(r.proposal){d.append(node('p','Approval binds the exact proposal digest below. A changed proposal requires a new decision.','muted'));const label=node('label','Proposal digest');const input=node('input');input.value=r.proposal.digest;input.readOnly=true;input.setAttribute('aria-label','Proposal digest');label.append(input);d.append(label)}const actions=node('div',undefined,'bar');for(const [name,title,enabled]of [['approve','Approve exact proposal',['awaiting_approval','awaiting_reapproval','approved'].includes(r.state)&&!!r.proposal],['reject','Reject proposal',r.state==='awaiting_approval'],['cancel',r.intent?'Request cancellation':'Cancel run',!['succeeded','failed','cancelled','rejected','budget_exceeded'].includes(r.state)],['resume','Reconcile / resume',!!r.intent&&['executing','unknown_outcome'].includes(r.state)]]){const b=node('button',title,name==='approve'?'primary':name==='reject'?'danger':'');b.disabled=!enabled;b.onclick=()=>act(async()=>{await api('api/runs/'+encodeURIComponent(r.runId)+'/'+name,name==='approve'?{proposalDigest:r.proposal.digest}:{});await refresh();status('Decision recorded. Current evidence refreshed.')});actions.append(b)}d.append(actions,section('Attempts',r.attempts??data.attempts??{models:r.budget?.models??{},tools:r.budget?.tools??{},reads:r.budget?.reads??{}}),section('Service receipt',r.receipt));const timeline=node('ol');for(const e of data.events??[]){const li=node('li');li.append(node('strong',e.kind),node('small',' · '+new Date(e.at).toISOString()),node('pre',JSON.stringify(e.data,null,2)));timeline.append(li)}d.append(node('h3','Durable event timeline'),timeline)}
async function act(fn){if(busy)return;busy=true;try{status('Working…');await fn();status('Evidence refreshed.')}catch(e){status(e.message)}finally{busy=false}}
$('loginForm').onsubmit=e=>{e.preventDefault();act(async()=>{let secret=$('secret').value;$('secret').value='';try{const result=await api('login',{secret});csrf=result.csrf;showWorkspace();await refresh()}finally{secret=''}})};
function nextLimits(){const result={};for(const key of ['modelTurns','toolCalls','activeMs','requestedModelTokens','readAttempts']){const input=$('limit-'+key);if(!input.checkValidity())throw Error('Enter valid next-run limits.');result[key]=Number(input.value)}return result}
$('refresh').onclick=()=>act(refresh);$('newRun').onclick=()=>act(async()=>{const result=await api('api/runs',{deliveryId:'delivery-001',limits:nextLimits()});selected=result.run.runId;await refresh()});$('reset').onclick=()=>act(async()=>{if(!confirm('Create a new logical dataset namespace? Existing runs and receipts will be preserved.'))return;await api('api/namespaces/reset',{});await refresh()});$('logout').onclick=()=>act(async()=>{await api('logout',{});showLogin()});
(async()=>{try{const s=await api('session');csrf=s.csrf;showWorkspace();await refresh()}catch{status('Sign in to inspect local workflow evidence.')}})();setInterval(()=>{if(csrf&&!busy)act(refresh)},4000);
</script></html>`;
}
