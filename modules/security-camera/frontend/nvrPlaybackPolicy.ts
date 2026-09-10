export type NvrSegment={id:string;started_at:string;ended_at?:string|null};
export function segmentAt(segments:NvrSegment[],timeMs:number){return segments.find(s=>Date.parse(s.started_at)<=timeMs&&Date.parse(s.ended_at||s.started_at)>=timeMs)||null}
export function clampPlayhead(timeMs:number,fromMs:number,toMs:number){return Math.max(fromMs,Math.min(toMs,timeMs))}
export function advancePlayhead(timeMs:number,elapsedMs:number,speed:number,toMs:number){return Math.min(toMs,timeMs+Math.max(0,elapsedMs)*Math.max(.25,Math.min(4,speed)))}
export function timelinePercent(timeMs:number,fromMs:number,toMs:number){if(toMs<=fromMs)return 0;return Math.max(0,Math.min(100,(timeMs-fromMs)/(toMs-fromMs)*100))}
export function playbackOffsetMs(segment:NvrSegment,timeMs:number){return Math.max(0,timeMs-Date.parse(segment.started_at))}
