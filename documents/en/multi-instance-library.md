# Multi-instance Library

Connect several MyTube servers so you can browse and play all of them from one. For example, keep videos on a NAS and a desktop, and watch both from the instance you usually open.

Two roles are involved, and one server can play both:

- **The sharing instance** issues an access key, which lets another server read its library.
- **The watching instance** connects with that key. It syncs the other library and plays its videos through itself.

Nothing is shared until you issue a key and connect with it.

Each instance shares only its own videos, not the ones it shows from other instances. If A connects to B and B connects to C, A does not see C's videos: connect A to C directly.

## Requirements

- Both servers run a MyTube version that includes this feature.
- The watching instance can reach the sharing instance over the network. Requests go from server to server, not from your browser.
- You are the owner on both: an admin, or login is disabled.

## Set it up

### 1. Issue an access key (on the sharing instance)

Open **Settings → Integrations & Advanced → Multi-instance library → Access for other instances** and choose **Issue access key**:

| Option | Meaning |
|---|---|
| Label | A name to recognize the key by, such as "Living room". |
| Permissions | **Browse the library** lists the videos and is always on, because connecting needs it. **Play media** also streams them; without it, the videos are listed but do not play. |
| Hidden videos | **Visible videos only** shares what visitors can see. **Includes hidden videos** also shares hidden ones. |
| Expires | Optional. The key stops working after this. |

The key is shown **only once**, so copy it right away. Each key works for one watching instance: the first instance that uses it keeps it.

### 2. Connect (on the watching instance)

Open **Settings → Integrations & Advanced → Multi-instance library → Connected instances** and choose **Connect instance**:

| Field | What to enter |
|---|---|
| Name | How the instance is labelled in your library. |
| Address | An address of the other MyTube that this server can reach. Requests come from this server, not your browser, so `localhost` means this server itself (or its container, in Docker). On a local network, use the other machine's address: with the two-container Docker setup that is usually `http://<host>:5556`; with the single container it is `http://<host>:5551`. |
| Access key | The key from step 1. |

A local-network address can use `http`. An address on the internet must use `https`.

### 3. Watch

The first sync runs straight away. After that, the instance syncs about once a minute, and **Sync now** runs one immediately. The other instance's videos then appear on the home page and in search, author and tag pages, labelled with the instance they come from, and play with seeking and subtitles.

## What works today

| Works | Not yet |
|---|---|
| Browsing, search, tags, authors | Visitors seeing remote videos (they stay owner-only; with login protection off, everyone counts as the owner, see *Network and security*) |
| Playback with seeking and subtitles | Collections and favorites with remote videos |
| A warning when the other instance is offline | Saving progress or counting views on this instance; the resume position stays on your device |
| Automatic sync about every minute | Editing, rating, tagging, or deleting remote videos (do that on their own instance) |

Remote videos are left out of bulk actions, the management page, statistics and Top Rated, because those act on this instance's own data.

## Status labels

| Status | Meaning | What to do |
|---|---|---|
| Waiting to sync | Just connected, re-enabled, or the key was replaced | Wait for the first sync, or choose **Sync now** |
| Synced | Up to date | — |
| Sync failed | The last sync failed (offline, timeout); the last synced videos stay listed | Check that the other instance is running and reachable |
| Access key refused | The other instance revoked, replaced or suspended the key, or it expired | Issue a new key there and choose **Replace access key** here |
| Access key unavailable | This instance can no longer read the saved key (see *Backups* below) | Restore the original key, restart and choose **Sync now**; or replace the access key |
| Another instance at this address | A different MyTube now answers at that address | Check the address; remove and reconnect if the move is intended |
| Needs an update | The other instance runs an incompatible version | Update both instances |

## Managing keys and connections

On the sharing instance, each key shows which instance uses it and when it was last used:

- **Replace key** issues a new secret and stops the old one immediately. Paste the new key on the watching instance.
- **Revoke** stops a key immediately and ends any playback that uses it.
- **Delete** removes a key for good.
- **Resume** re-enables a key that a database restore suspended.

On the watching instance:

- Turning a connection off hides its videos at once.
- **Remove** deletes the synced entries on this instance only. Nothing is deleted on the other instance.

## Network and security

- A plain `http` address is accepted only when it resolves to private addresses, and is checked again on every connection, so a name that later points to the internet is refused. Requests to such an instance never go through a proxy.
- Remote videos are shown only to the owner. With login protection off, everyone who can open the watching instance counts as the owner and sees them, so turn login on or limit who can reach it.
- The sharing instance stores only a hash of each key. Visibility is checked on every request, so hiding a video stops keys limited to visible videos from reading it straight away. A key that includes hidden videos still reads it; revoke that key to stop access.
- The watching instance stores keys encrypted with `federation.key` in its data directory (`data/`, unless `MYTUBE_BACKEND_DATA_DIR` moves it), or with the `MYTUBE_FEDERATION_KEY` environment variable when it is set. Browsing and playback go through this instance, so the library and player never receive the other instance's address or its storage links; the address appears only in these settings.
- The included Nginx configuration streams `/api/federation/media` and `/api/federation/v1` unbuffered. If you use your own reverse proxy, do the same so seeking works.

## Backups and restores

- Back up the key that protects saved access keys along with your database: the `MYTUBE_FEDERATION_KEY` value if you set it, otherwise `federation.key` from the data directory. If it is lost or changes, connected instances show *Access key unavailable*. Restore the original key, restart MyTube and choose **Sync now** to recover them; only if the key is gone for good do you need to replace their access keys one by one.
- Restoring or importing a database suspends every key the instance had issued, and turns off every connection it had made. Resume or replace the keys, and turn the connections back on, once you have checked them.
- If you copy a deployment and keep both copies running, choose **Reset identity** on the copy. It gets a new instance ID, and the keys it inherited are revoked.
