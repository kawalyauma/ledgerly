-- Security camera WebRTC/WHIP runtime and NVR media health.
ALTER TABLE security_camera_servers ADD COLUMN webrtc_base_url TEXT;
ALTER TABLE security_camera_servers ADD COLUMN webrtc_public_base_url TEXT;
ALTER TABLE security_camera_servers ADD COLUMN media_status TEXT NOT NULL DEFAULT 'offline';
ALTER TABLE security_camera_servers ADD COLUMN media_last_seen_at TEXT;
ALTER TABLE security_cameras ADD COLUMN stream_status TEXT NOT NULL DEFAULT 'offline';
ALTER TABLE security_cameras ADD COLUMN last_stream_at TEXT;
CREATE INDEX IF NOT EXISTS idx_security_camera_servers_media ON security_camera_servers(organization_id,media_status,media_last_seen_at);
CREATE INDEX IF NOT EXISTS idx_security_cameras_stream ON security_cameras(organization_id,stream_status,last_stream_at);
