# Sync Manager Plugin — Migration Guide

This guide documents how to migrate from the legacy `SyncManager` / `VOSSynchronizationService` to the new `wos-plugin-sync-manager` plugin.

## WOS Bus Topic Changes

The sync-manager plugin uses a new topic namespace. Legacy topics are still supported but emit deprecation warnings.

### Session Operations

| Legacy Topic | New Topic | Notes |
|---|---|---|
| `wos/sync/createsession` | `wos/sync-manager/session/create` | See payload changes below |
| `wos/sync/deletesession` | `wos/sync-manager/session/destroy` | Renamed from "delete" to "destroy" |
| `wos/sync/getsessions` | `wos/sync-manager/session/list` | Response format unchanged |
| — | `wos/sync-manager/session/get` | New: get single session info |

### World Operations

| Legacy Topic | New Topic |
|---|---|
| `wos/sync/openworld` | `wos/sync-manager/world/open` |
| `wos/sync/closeworld` | `wos/sync-manager/world/close` |

### Token Operations

| Legacy Topic | New Topic | Notes |
|---|---|---|
| `wos/sync/usertoken` | `wos/sync-manager/user/token` | See field name changes below |

### New Topics (no legacy equivalent)

| Topic | Purpose |
|---|---|
| `wos/sync-manager/lifecycle/session-created` | Domain event after session creation |
| `wos/sync-manager/lifecycle/session-destroyed` | Domain event after session destruction |
| `wos/sync-manager/lifecycle/client-joined` | Reserved for future use (not yet implemented) |
| `wos/sync-manager/lifecycle/client-left` | Reserved for future use (not yet implemented) |

## Payload / Field Name Changes

### Create Session

**Legacy** (`wos/sync/createsession`):
```json
{
  "id": "caller-provided-session-id",
  "tag": "world.5.10"
}
```

**New** (`wos/sync-manager/session/create`):
```json
{
  "correlationId": "unique-request-id",
  "tag": "world.5.10",
  "clientId": "client-identifier",
  "clientToken": "jwt-token"
}
```

**Breaking change:** In the legacy format, `id` was a caller-provided session ID. WorldSync 2.0 generates session IDs internally. The backward-compat handler uses the legacy `id` field as a `clientId` instead. The response always returns the WorldSync-generated `sessionId`.

### Destroy Session

**Legacy** (`wos/sync/deletesession`):
```json
{ "id": "session-id" }
```

**New** (`wos/sync-manager/session/destroy`):
```json
{
  "correlationId": "unique-request-id",
  "sessionId": "session-id"
}
```

### User Token

**Legacy** (`wos/sync/usertoken`):
```json
{ "userid": "user-1", "token": "jwt-token" }
```

**New** (`wos/sync-manager/user/token`):
```json
{ "userId": "user-1", "token": "jwt-token" }
```

Note: `userid` (lowercase) changed to `userId` (camelCase).

## Auth Flow Changes

In the legacy system, user tokens were stored locally and used without validation.

The new sync-manager plugin:
1. Receives tokens via `wos/sync-manager/user/token` (or legacy `wos/sync/usertoken`)
2. Validates tokens against the **identity plugin** via WOS bus (`wos/identity/auth/validate`)
3. Caches validation results (configurable TTL via `token_cache_ttl_ms`)
4. Checks region-level permissions before session creation
5. Checks entity-level permissions for entity CRUD operations

Tokens that fail validation are rejected (fail-closed). The identity plugin must be running.

## WorldSync Topic Changes

WorldSync 2.0 changed its internal MQTT topic namespace:

| Legacy (WorldSync 1.x) | New (WorldSync 2.0) |
|---|---|
| `vos/{sessionId}/...` | `wsync/{sessionId}/...` |

This change is internal to WorldSync and transparent to WOS bus consumers. Only direct WorldSync MQTT subscribers are affected.

## Entity Type Expansion

WorldSync 2.0 supports all 21 entity types (previously limited). Each entity operation now goes through permission checks:

- **Region read permission** required for: `session.join`, `session.heartbeat`
- **Region write permission** required for: `session.create`, `session.destroy`, `entity.create`
- **Entity write permission** required for: `entity.delete`, `entity.update.*`

Permissions use the existing region database schema (`region_registry` and `entities` tables). Default permissions apply when database fields are NULL:
- Owner: full read/write/use/take
- Other: read only (no write/use/take)

## Backward Compatibility Summary

### What still works (deprecated, with warnings):
- `wos/sync/createsession` — creates session, `id` field used as `clientId`
- `wos/sync/deletesession` — destroys session using `id` as `sessionId`
- `wos/sync/getsessions` — lists sessions
- `wos/sync/usertoken` — stores token using `userid` field
- `wos/sync/openworld` — opens world
- `wos/sync/closeworld` — closes world

### What breaks:
- Caller-provided session IDs are no longer used — WorldSync generates IDs internally
- Token validation now requires the identity plugin to be running
- Entity operations require region/entity permissions (fail-closed if DB unavailable)
- Legacy response topics use `wos/sync/{command}/response` (not the new `wos/sync-manager/*/response`)

### Migration steps:
1. Update topic subscriptions from `wos/sync/*` to `wos/sync-manager/*`
2. Update payload field names (`id` → `sessionId`/`clientId`, `userid` → `userId`)
3. Add `correlationId` to all requests for response correlation
4. Ensure the identity plugin is running and configured
5. Ensure world.db and region databases are accessible for permission checks
