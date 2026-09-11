import {SECURITY_CAMERA_TABLES} from '../security-camera-manifest.mjs';
import {ensureSecurityCameraSchema} from '../security-camera-schema.mjs';
import {SECURITY_CAMERA_RELATIONSHIP_CHECKS} from '../security-camera-validators.mjs';

export default{
 name:'security-camera',
 description:'Security camera/NVR metadata, appliance runtime, live grants, recordings, events, resilience and forensic evidence',
 prerequisites:['auth-core'],
 tables:SECURITY_CAMERA_TABLES,
 ensureSchema:ensureSecurityCameraSchema,
 finalizeSchema:null,
 relationshipChecks:SECURITY_CAMERA_RELATIONSHIP_CHECKS,
};