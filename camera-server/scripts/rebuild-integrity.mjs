import {RecordingCatalog} from "../src/catalog.mjs";
import {RecordingIntegrity} from "../src/integrity.mjs";

const storageRoot=process.env.CAMERA_STORAGE_ROOT;
const stateFile=process.env.CAMERA_INTEGRITY_STATE;
if(!storageRoot||!stateFile)throw new Error("CAMERA_STORAGE_ROOT and CAMERA_INTEGRITY_STATE are required");

const catalog=new RecordingCatalog({storageRoot});
const integrity=new RecordingIntegrity({stateFile});
const rows=catalog.cameras().flatMap(cameraId=>catalog.all(cameraId));
await integrity.enrichBatch(rows);
console.log(`Rebuilt integrity metadata for ${rows.length} recording(s)`);
