export const SECURITY_CAMERA_RELATIONSHIP_CHECKS=Object.freeze([
 ['security-camera.camera_server_tenant',`SELECT count(*)::bigint count FROM security_cameras c JOIN security_camera_servers s ON s.id=c.server_id WHERE c.organization_id<>s.organization_id`],
 ['security-camera.recording_camera_tenant',`SELECT count(*)::bigint count FROM security_camera_recordings r JOIN security_cameras c ON c.id=r.camera_id WHERE r.organization_id<>c.organization_id`],
 ['security-camera.recording_server_tenant',`SELECT count(*)::bigint count FROM security_camera_recordings r JOIN security_camera_servers s ON s.id=r.server_id WHERE r.organization_id<>s.organization_id`],
 ['security-camera.live_camera_tenant',`SELECT count(*)::bigint count FROM security_camera_live_sessions l JOIN security_cameras c ON c.id=l.camera_id WHERE l.organization_id<>c.organization_id`],
 ['security-camera.event_camera_tenant',`SELECT count(*)::bigint count FROM security_camera_events e JOIN security_cameras c ON c.id=e.camera_id WHERE e.organization_id<>c.organization_id`],
 ['security-camera.redundancy_tenant',`SELECT count(*)::bigint count FROM security_camera_redundancy r JOIN security_cameras c ON c.id=r.camera_id JOIN security_camera_servers p ON p.id=r.primary_server_id JOIN security_camera_servers s ON s.id=r.secondary_server_id WHERE r.organization_id<>c.organization_id OR r.organization_id<>p.organization_id OR r.organization_id<>s.organization_id`]
]);
