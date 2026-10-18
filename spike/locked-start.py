"""POSIX-only spike launcher; exec the actual built worker while holding its lock."""
import fcntl
import os
from pathlib import Path
import sys

if os.environ.get('ARL_SPIKE_TEST') != '1':
    sys.exit('Explicit ARL_SPIKE_TEST=1 required')
if not os.environ.get('ARL_SPIKE_SECRET'):
    sys.exit('Missing ephemeral operator secret')
port = int(sys.argv[2])
if not 1 <= port <= 65535:
    sys.exit('Invalid loopback port')
state = Path('.eve')
state.mkdir(exist_ok=True)
lock = os.open(state / 'spike-worker.lock', os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(73)
os.set_inheritable(lock, True)
# Keep the inode and exec the worker, not a supervisor which spawns an unlocked child.
# This is the same generated Nitro server entry used by eve start in pinned 0.80.1.
runtime_env = dict(os.environ)
runtime_env.update(HOST='127.0.0.1', NITRO_HOST='127.0.0.1', PORT=str(port), NITRO_PORT=str(port))
os.execve(sys.argv[1], [sys.argv[1], '.output/server/index.mjs'], runtime_env)
