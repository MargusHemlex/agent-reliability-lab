"""POSIX-only spike launcher; the lock is held by the exec'ed eve CLI process."""
import fcntl
import os
from pathlib import Path
import sys

if os.environ.get('ARL_SPIKE_TEST') != '1':
    sys.exit('Explicit ARL_SPIKE_TEST=1 required')
if not os.environ.get('ARL_SPIKE_SECRET'):
    sys.exit('Missing ephemeral operator secret')
state = Path('.eve')
state.mkdir(exist_ok=True)
lock = os.open(state / 'spike-worker.lock', os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(73)
os.set_inheritable(lock, True)
# Do not unlink the lock inode: a second process must contend on this same file.
os.execv(sys.argv[1], [sys.argv[1], 'node_modules/eve/bin/eve.js', 'start', '--host', '127.0.0.1', '--port', sys.argv[2]])
