export async function ensureSecurityCameraSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS security_camera_servers (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL, location text, status text NOT NULL DEFAULT 'offline',
      local_base_url text, relay_id text, storage_total_bytes bigint NOT NULL DEFAULT 0,
      storage_free_bytes bigint NOT NULL DEFAULT 0, last_seen_at timestamptz,
      credential_hash text, capabilities_json text, hostname text, app_version text,
      paired_at timestamptz, webrtc_base_url text, webrtc_public_base_url text,
      media_status text NOT NULL DEFAULT 'offline', media_last_seen_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS security_camera_servers_org_idx ON security_camera_servers(organization_id,status);
    CREATE INDEX IF NOT EXISTS security_camera_servers_media_idx ON security_camera_servers(organization_id,media_status,media_last_seen_at);

    CREATE TABLE IF NOT EXISTS security_camera_pairings (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by text NOT NULL, camera_name text NOT NULL, location text, server_id text REFERENCES security_camera_servers(id) ON DELETE SET NULL,
      token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS security_camera_pairings_org_idx ON security_camera_pairings(organization_id,expires_at);

    CREATE TABLE IF NOT EXISTS security_camera_server_pairings (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by text NOT NULL, name text NOT NULL, location text, token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS security_camera_server_pairings_org_idx ON security_camera_server_pairings(organization_id,expires_at);

    CREATE TABLE IF NOT EXISTS security_cameras (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      server_id text REFERENCES security_camera_servers(id) ON DELETE SET NULL, name text NOT NULL, location text,
      status text NOT NULL DEFAULT 'offline', credential_hash text NOT NULL, device_model text, platform text,
      app_version text, capabilities_json text, battery_level double precision, temperature_c double precision,
      wifi_strength double precision, paired_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz,
      revoked_at timestamptz, recording_enabled boolean NOT NULL DEFAULT true, last_recording_at timestamptz,
      stream_status text NOT NULL DEFAULT 'offline', last_stream_at timestamptz,
      capture_paused boolean NOT NULL DEFAULT false, pause_reason text, remediation_count integer NOT NULL DEFAULT 0,
      last_remediation_at timestamptz, nvr_reachability text NOT NULL DEFAULT 'unknown', health_score integer NOT NULL DEFAULT 100,
      health_state text NOT NULL DEFAULT 'unknown', health_issues_json text NOT NULL DEFAULT '[]', health_evaluated_at timestamptz,
      charging boolean, thermal_status integer, device_owner boolean, appliance_running boolean, wake_lock boolean,
      pending_segments integer NOT NULL DEFAULT 0, spool_bytes bigint NOT NULL DEFAULT 0, spool_free_bytes bigint,
      buffer_pressure integer NOT NULL DEFAULT 0, diagnostics_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS security_cameras_org_idx ON security_cameras(organization_id,status);
    CREATE INDEX IF NOT EXISTS security_cameras_server_idx ON security_cameras(server_id,status);
    CREATE INDEX IF NOT EXISTS security_cameras_stream_idx ON security_cameras(organization_id,stream_status,last_stream_at);

    CREATE TABLE IF NOT EXISTS security_camera_recordings (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
      server_id text REFERENCES security_camera_servers(id) ON DELETE SET NULL,
      started_at timestamptz NOT NULL, ended_at timestamptz, local_path text NOT NULL,
      size_bytes bigint NOT NULL DEFAULT 0, checksum text, protected boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'recording', content_sha256 text, previous_chain_sha256 text, chain_sha256 text,
      integrity_status text NOT NULL DEFAULT 'unverified', integrity_computed_at timestamptz,
      integrity_verified_at timestamptz, integrity_mismatch_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(server_id,camera_id,local_path)
    );
    CREATE INDEX IF NOT EXISTS security_camera_recordings_timeline_idx ON security_camera_recordings(camera_id,started_at DESC);
    CREATE INDEX IF NOT EXISTS security_camera_recordings_integrity_idx ON security_camera_recordings(organization_id,integrity_status,started_at DESC);

    CREATE TABLE IF NOT EXISTS security_camera_live_sessions (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
      requested_by text NOT NULL, status text NOT NULL DEFAULT 'requested', signaling_key text NOT NULL,
      expires_at timestamptz NOT NULL, ended_at timestamptz, offer_sdp text, answer_sdp text, ice_json text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS security_camera_live_status_idx ON security_camera_live_sessions(organization_id,status,expires_at);

    CREATE TABLE IF NOT EXISTS security_camera_profiles (
      camera_id text PRIMARY KEY REFERENCES security_cameras(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      preferred_facing text NOT NULL DEFAULT 'back', width integer NOT NULL DEFAULT 1280,
      height integer NOT NULL DEFAULT 720, fps integer NOT NULL DEFAULT 15, bitrate_kbps integer NOT NULL DEFAULT 1200,
      segment_seconds integer NOT NULL DEFAULT 20, retention_days integer NOT NULL DEFAULT 30,
      audio_enabled boolean NOT NULL DEFAULT false, motion_enabled boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_server_runtime (
      server_id text PRIMARY KEY REFERENCES security_camera_servers(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      public_control_base_url text, cpu_percent double precision, memory_percent double precision,
      uptime_seconds bigint, active_streams integer NOT NULL DEFAULT 0, active_viewers integer NOT NULL DEFAULT 0,
      last_error text, updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_server_volumes (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      server_id text NOT NULL REFERENCES security_camera_servers(id) ON DELETE CASCADE, volume_key text NOT NULL,
      label text NOT NULL, path text NOT NULL, priority integer NOT NULL DEFAULT 100,
      total_bytes bigint NOT NULL DEFAULT 0, free_bytes bigint NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'online',
      last_seen_at timestamptz NOT NULL DEFAULT now(), UNIQUE(server_id,volume_key)
    );

    CREATE TABLE IF NOT EXISTS security_camera_alerts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text REFERENCES security_cameras(id) ON DELETE SET NULL, server_id text REFERENCES security_camera_servers(id) ON DELETE SET NULL,
      alert_type text NOT NULL, severity text NOT NULL DEFAULT 'warning', status text NOT NULL DEFAULT 'open',
      message text NOT NULL, details_json text, first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz, acknowledged_by text, resolved_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS security_camera_alerts_org_status_idx ON security_camera_alerts(organization_id,status,last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS security_camera_access_grants (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requested_by text NOT NULL, server_id text NOT NULL REFERENCES security_camera_servers(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE, kind text NOT NULL,
      token text NOT NULL UNIQUE, payload_json text NOT NULL, expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_exports (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requested_by text NOT NULL, server_id text NOT NULL REFERENCES security_camera_servers(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE, from_at timestamptz NOT NULL,
      to_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'requested', local_path text, size_bytes bigint NOT NULL DEFAULT 0,
      error_message text, content_sha256 text, manifest_sha256 text, integrity_status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS security_camera_zones (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE, name text NOT NULL,
      zone_type text NOT NULL DEFAULT 'motion', polygon_json text NOT NULL DEFAULT '[]',
      enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_schedules (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text REFERENCES security_cameras(id) ON DELETE CASCADE, name text NOT NULL,
      days_json text NOT NULL DEFAULT '[0,1,2,3,4,5,6]', start_time text NOT NULL DEFAULT '00:00',
      end_time text NOT NULL DEFAULT '23:59', timezone text NOT NULL DEFAULT 'Africa/Kampala',
      enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_event_rules (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text REFERENCES security_cameras(id) ON DELETE CASCADE, name text NOT NULL, event_type text NOT NULL,
      min_confidence double precision NOT NULL DEFAULT 0, severity text NOT NULL DEFAULT 'warning',
      protect_clip boolean NOT NULL DEFAULT true, create_alert boolean NOT NULL DEFAULT true,
      schedule_id text REFERENCES security_camera_schedules(id) ON DELETE SET NULL,
      zone_id text REFERENCES security_camera_zones(id) ON DELETE SET NULL, enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
      server_id text REFERENCES security_camera_servers(id) ON DELETE SET NULL, event_type text NOT NULL,
      severity text NOT NULL DEFAULT 'info', confidence double precision, source text NOT NULL DEFAULT 'nvr',
      started_at timestamptz NOT NULL, ended_at timestamptz, zone_id text, recording_id text,
      snapshot_path text, protected boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'open',
      metadata_json text NOT NULL DEFAULT '{}', reviewed_by text, reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS security_camera_events_org_time_idx ON security_camera_events(organization_id,started_at DESC);

    CREATE TABLE IF NOT EXISTS security_camera_incidents (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE, event_id text,
      title text NOT NULL, notes text, from_at timestamptz NOT NULL, to_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'open', created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS security_camera_groups (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL, description text, created_by text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
    );
    CREATE TABLE IF NOT EXISTS security_camera_group_members (
      group_id text NOT NULL REFERENCES security_camera_groups(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE,
      position integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(group_id,camera_id)
    );
    CREATE TABLE IF NOT EXISTS security_camera_wall_views (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL, group_id text REFERENCES security_camera_groups(id) ON DELETE SET NULL,
      columns integer NOT NULL DEFAULT 2, muted boolean NOT NULL DEFAULT true, created_by text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
    );
    CREATE TABLE IF NOT EXISTS security_camera_wall_view_items (
      view_id text NOT NULL REFERENCES security_camera_wall_views(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id) ON DELETE CASCADE, position integer NOT NULL DEFAULT 0,
      PRIMARY KEY(view_id,camera_id)
    );
    CREATE TABLE IF NOT EXISTS security_camera_lifecycle (
      camera_id text PRIMARY KEY REFERENCES security_cameras(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lifecycle_status text NOT NULL DEFAULT 'active', note text, updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_audit_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_id text NOT NULL, action text NOT NULL, resource_type text NOT NULL, resource_id text,
      camera_id text, server_id text, ip_address text, user_agent text, details_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_notification_policies (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL, enabled boolean NOT NULL DEFAULT true, minimum_severity text NOT NULL DEFAULT 'warning',
      event_types_json text NOT NULL DEFAULT '[]', channels_json text NOT NULL DEFAULT '[]',
      recipients_json text NOT NULL DEFAULT '[]', schedule_id text, escalation_minutes integer NOT NULL DEFAULT 0,
      cooldown_minutes integer NOT NULL DEFAULT 10, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_notification_queue (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      policy_id text NOT NULL REFERENCES security_camera_notification_policies(id) ON DELETE CASCADE,
      alert_id text NOT NULL, channel text NOT NULL, recipient text NOT NULL, status text NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0, not_before timestamptz NOT NULL DEFAULT now(), payload_json text NOT NULL DEFAULT '{}',
      last_error text, communication_campaign_id text, communication_delivery_id text, provider_status text, provider_error text,
      delivered_at timestamptz, email_message_id text, webhook_event_id text, in_app_notification_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS security_camera_server_update_policies (
      server_id text PRIMARY KEY REFERENCES security_camera_servers(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      desired_version text, update_channel text NOT NULL DEFAULT 'stable', auto_update_enabled boolean NOT NULL DEFAULT false,
      maintenance_start text, maintenance_end text, requested_by text, requested_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS security_camera_redundancy (
      camera_id text PRIMARY KEY REFERENCES security_cameras(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      primary_server_id text NOT NULL REFERENCES security_camera_servers(id),
      secondary_server_id text NOT NULL REFERENCES security_camera_servers(id),
      mode text NOT NULL DEFAULT 'automatic', failover_after_seconds integer NOT NULL DEFAULT 90,
      failback_enabled boolean NOT NULL DEFAULT true, failback_after_seconds integer NOT NULL DEFAULT 300,
      state text NOT NULL DEFAULT 'primary', state_changed_at timestamptz NOT NULL DEFAULT now(),
      primary_healthy_since timestamptz, last_evaluated_at timestamptz, last_reason text,
      enabled boolean NOT NULL DEFAULT true, updated_by text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_failover_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL, from_server_id text, to_server_id text, reason text NOT NULL,
      automatic boolean NOT NULL DEFAULT true, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_validation_runs (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      server_id text, camera_id text, check_type text NOT NULL, status text NOT NULL, message text,
      details_json text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_inbox (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text NOT NULL, notification_queue_id text NOT NULL, alert_id text NOT NULL,
      severity text NOT NULL DEFAULT 'warning', title text NOT NULL, message text NOT NULL,
      camera_id text, server_id text, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(notification_queue_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS security_camera_backup_status (
      server_id text PRIMARY KEY REFERENCES security_camera_servers(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'disabled',
      pending_files integer NOT NULL DEFAULT 0, pending_bytes bigint NOT NULL DEFAULT 0,
      oldest_pending_at timestamptz, lag_seconds integer NOT NULL DEFAULT 0,
      copied_files bigint NOT NULL DEFAULT 0, copied_bytes bigint NOT NULL DEFAULT 0,
      last_success_at timestamptz, last_error text, last_reported_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_health_events (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id), health_score integer NOT NULL,
      health_state text NOT NULL, classification text NOT NULL, issues_json text NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_commissioning_runs (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      run_type text NOT NULL CHECK(run_type IN ('readiness_certification','recovery_drill')),
      status text NOT NULL CHECK(status IN ('passed','warning','failed')), score integer NOT NULL DEFAULT 0,
      passed boolean NOT NULL DEFAULT false, actor_id text, summary text, details_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_recording_integrity_checks (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      recording_id text NOT NULL REFERENCES security_camera_recordings(id), camera_id text NOT NULL REFERENCES security_cameras(id),
      server_id text REFERENCES security_camera_servers(id), expected_sha256 text, observed_sha256 text,
      expected_previous_chain_sha256 text, observed_previous_chain_sha256 text, observed_chain_sha256 text,
      status text NOT NULL CHECK(status IN ('accepted','verified','tampered','chain_broken','unverified')),
      checked_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_legal_holds (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      incident_id text REFERENCES security_camera_incidents(id), camera_id text NOT NULL REFERENCES security_cameras(id),
      from_at timestamptz NOT NULL, to_at timestamptz NOT NULL, reason text NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','released')), created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), released_by text, released_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS security_camera_custody_log (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      evidence_type text NOT NULL, evidence_id text NOT NULL, action text NOT NULL, actor_user_id text,
      details_json text NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS security_camera_export_manifests (
      export_id text PRIMARY KEY REFERENCES security_camera_exports(id), organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      camera_id text NOT NULL REFERENCES security_cameras(id), incident_id text REFERENCES security_camera_incidents(id),
      manifest_json text NOT NULL, manifest_sha256 text NOT NULL, hmac_sha256 text,
      signing_status text NOT NULL DEFAULT 'unsigned' CHECK(signing_status IN ('signed','unsigned')),
      created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz,
      verification_status text NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','verified','mismatch'))
    );
  `);
}
