# LaundrySystem

To run manually:

```bash
sed -i 's/\r$//' ~/start_kiosk.sh
chmod +x ~/start_kiosk.sh
~/start_kiosk.sh
```

## Apply the offline-first changes from this branch

If your local code does not yet include the offline-first updates, apply the commit directly:

```bash
git fetch origin
git checkout <your-branch>
git cherry-pick 332f112
```

If you already pulled this branch, you can verify the commit is present:

```bash
git log --oneline -n 20
```

Look for:

```text
332f112 Finalize offline-first behavior: non-blocking lock/unlock, local persistence, background sync, and action queue
```

## Validate after applying

From the repository root:

```bash
node --check laundry-kiosk/server.js
python -m py_compile laundry-kiosk/hardware_bridge.py
```

Optional runtime smoke test:

```bash
cd laundry-kiosk
node server.js
# In another terminal, call /api/lock, /api/dropoff, /api/lockers, /api/pickup, /api/unlock
```
