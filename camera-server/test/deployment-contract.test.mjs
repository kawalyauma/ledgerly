import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve("..");
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");

test("NVR media lifecycle is independent from Ledgerly finance/API services",()=>{const compose=read("camera-server/docker-compose.yml"),finance=read("compose.finance-runtime.yml");assert.match(compose,/name:\s*ledgerly-camera-nvr/);assert.doesNotMatch(compose,/depends_on:/);assert.doesNotMatch(compose,/postgres|pgbouncer|redis|printerly|ledgerly-api/);assert.doesNotMatch(finance,/nvr-mediamtx|image:\s*bluenviron\/mediamtx/)});

test("MediaMTX admin and auth coordination stay local while reconnect recording stays enabled",()=>{const config=read("camera-server/mediamtx.yml");assert.match(config,/apiAddress:\s*127\.0\.0\.1:9997/);assert.match(config,/authHTTPAddress:\s*http:\/\/127\.0\.0\.1:8789\/v1\/media\/auth/);assert.match(config,/overridePublisher:\s*yes/);assert.match(config,/record:\s*yes/);assert.match(config,/hls:\s*yes/);assert.match(config,/webrtc:\s*yes/)});

test("pairing is race-safe and camera/server config remains tenant and revocation scoped",()=>{const source=read("modules/security-camera/backend/service.ts");assert.match(source,/consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP/);assert.match(source,/meta\?\.changes\|\|0\)!==1/);assert.match(source,/c\.revoked_at IS NULL/);assert.match(source,/organization_id=\? AND server_id=\? AND revoked_at IS NULL/);assert.match(source,/server\.organization_id,server\.id/)});

test("systemd grants Docker privilege only to the one-shot media startup command",()=>{const unit=read("camera-server/install/ledgerly-camera.service"),installer=read("camera-server/install/install.sh");assert.match(unit,/ExecStartPre=\+\/usr\/bin\/docker compose up -d mediamtx/);assert.doesNotMatch(unit,/SupplementaryGroups=docker/);assert.match(unit,/NoNewPrivileges=true/);assert.doesNotMatch(installer,/usermod -aG docker/)});

test("public edge omits media administration and local media-auth endpoints",()=>{const caddy=read("camera-server/Caddyfile.example");assert.match(caddy,/handle \/v1\/access\/\*/);assert.match(caddy,/handle_path \/media\/\*/);assert.doesNotMatch(caddy,/reverse_proxy 127\.0\.0\.1:9997/);assert.doesNotMatch(caddy,/handle \/v1\/media\/auth/)});
