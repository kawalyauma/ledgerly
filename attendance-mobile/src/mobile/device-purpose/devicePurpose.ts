import {OfflineStore} from "../../native";
export type DevicePurpose="normal"|"attendance-kiosk"|"security-camera";
const KEY="mobile.device.purpose";
export async function readDevicePurpose():Promise<DevicePurpose|null>{const value=await OfflineStore.getSecure(KEY);return value==="normal"||value==="attendance-kiosk"||value==="security-camera"?value:null}
export async function saveDevicePurpose(value:DevicePurpose){await OfflineStore.putSecure(KEY,value)}
export async function clearDevicePurpose(){await OfflineStore.removeSecure(KEY)}
