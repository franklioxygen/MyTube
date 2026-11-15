# Multi-instance Library

Connect several MyTube servers so you can browse and play all of them from one. For example, keep videos on a NAS and a desktop, and watch both from the instance you usually open.

Two roles are involved, and one server can play both:

- **The sharing instance** issues an access key, which lets another server read its library.
- **The watching instance** connects with that key. It syncs the other library and plays its videos through itself.

Nothing is shared until you issue a key and connect with it.

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
| Permissions | **Browse the library** lists the videos. **Play media** also streams them; without it, the videos are listed but do not play. |
| Hidden videos | **Visible videos only** shares what visitors can see. **Includes hidden videos** also shares hidden ones. |
| Expires | Optional. The key stops working after this. |

The key is shown **only once**, so copy it right away. Each key works for one watching instance: the first instance that uses it keeps it.

### 2. Connect (on the watching instance)

Open **Settings → Integrations & Advanced → Multi-instance library → Connected instances** and choose **Connect instance**:

| Field | What to enter |
|---|---|
| Name | How the instance is labelled in your library. |
| Address | The address you open the other MyTube at in a browser. With the two-container Docker setup that is usually `http://<host>:5556`; with the single container it is `http://<host>:5551`. |
| Access key | The key from step 1. |

A local-network address can use `http`. An address on the internet must use `https`.

### 3. Watch

The first sync runs straight away. After that, the instance syncs about once a minute, and **Sync now** runs one immediately. The other instance's videos then appear on the home page and in search, author and tag pages, labelled with the instance they come from, and play with seeking and subtitles.

## What works today

| Works | Not yet |
|---|---|
| Browsing, search, tags, authors | Visitors seeing remote videos (they stay owner-only) |
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
| Access key unavailable | This instance can no longer read the saved key (see *Backups* below) | Restore the key file, or replace the access key |
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
- The sharing instance stores only a hash of each key. Visibility is checked on every request, so hiding a video takes effect straight away.
- The watching instance stores keys encrypted with `data/federation.key`, or with the `MYTUBE_FEDERATION_KEY` environment variable when it is set. Neither the other instance's address nor its storage links reach your browser.
- The included Nginx configuration streams `/api/federation/media` and `/api/federation/v1` unbuffered. If you use your own reverse proxy, do the same so seeking works.

## Backups and restores

- Back up `data/federation.key` along with your database. Without it, connected instances show *Access key unavailable* until you replace their keys.
- Restoring or importing a database suspends every key the instance had issued, and turns off every connection it had made. Resume or replace the keys, and turn the connections back on, once you have checked them.
- If you copy a deployment and keep both copies running, choose **Reset identity** on the copy. It gets a new instance ID, and the keys it inherited are revoked.
