import {describe,expect,it} from "vitest";
import type {Env} from "../../../src/types";
import {buildIceConfig} from "./turn";
import {ringTimeoutSeconds} from "./policy";

const env=(values:Partial<Env>={})=>values as Env;

describe("Audio Calls ICE configuration",()=>{
  it("uses the safe default STUN server without TURN",async()=>{
    const config=await buildIceConfig(env(),"usr_1");
    expect(config.iceServers[0]).toEqual({urls:["stun:stun.cloudflare.com:3478"]});
    expect(config.turnConfigured).toBe(false);
    expect(config.credentialMode).toBe("none");
  });

  it("supports existing static TURN credentials",async()=>{
    const config=await buildIceConfig(env({AUDIO_CALL_TURN_URLS:"turn:relay.example:3478",AUDIO_CALL_TURN_USERNAME:"legacy",AUDIO_CALL_TURN_CREDENTIAL:"secret"}),"usr_1");
    expect(config.turnConfigured).toBe(true);
    expect(config.credentialMode).toBe("static");
    expect(config.iceServers[1]).toMatchObject({urls:["turn:relay.example:3478"],username:"legacy",credential:"secret"});
  });

  it("prefers short-lived TURN REST credentials",async()=>{
    const before=Math.floor(Date.now()/1000);
    const config=await buildIceConfig(env({AUDIO_CALL_TURN_URLS:"turn:relay.example:3478,turns:relay.example:5349",AUDIO_CALL_TURN_SECRET:"shared-secret",AUDIO_CALL_TURN_TTL_SECONDS:"600",AUDIO_CALL_TURN_USERNAME:"legacy",AUDIO_CALL_TURN_CREDENTIAL:"legacy-secret"}),"usr_abc");
    expect(config.turnConfigured).toBe(true);
    expect(config.credentialMode).toBe("ephemeral");
    const server=config.iceServers[1] as {username?:string;credential?:string;urls?:string|string[]};
    expect(server.username).toMatch(/^\d+:usr_abc$/);
    expect(server.credential?.length).toBeGreaterThan(10);
    const expiry=Number(server.username!.split(":")[0]);
    expect(expiry).toBeGreaterThanOrEqual(before+595);
    expect(expiry).toBeLessThanOrEqual(before+605);
    expect(server.urls).toEqual(["turn:relay.example:3478","turns:relay.example:5349"]);
  });
});

describe("Audio Calls policy",()=>{
  it("defaults and clamps ringing timeout",()=>{
    expect(ringTimeoutSeconds(env())).toBe(35);
    expect(ringTimeoutSeconds(env({AUDIO_CALL_RING_TIMEOUT_SECONDS:"2"}))).toBe(10);
    expect(ringTimeoutSeconds(env({AUDIO_CALL_RING_TIMEOUT_SECONDS:"999"}))).toBe(120);
    expect(ringTimeoutSeconds(env({AUDIO_CALL_RING_TIMEOUT_SECONDS:"50"}))).toBe(50);
  });
});
