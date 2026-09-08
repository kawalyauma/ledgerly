import test from "node:test";
import assert from "node:assert/strict";
import {buildLpArgs,extensionForMime,parseLpRequestId,sha256} from "../src/lib.mjs";

test("parses the CUPS request id",()=>{
  assert.equal(parseLpRequestId("request id is Office_Printer-148 (1 file(s))"),"Office_Printer-148");
  assert.equal(parseLpRequestId(""),null);
});

test("builds safe lp arguments from a Printerly job",()=>{
  assert.deepEqual(buildLpArgs({
    printer_system_name:"Office_Printer",copies:2,page_size:"A4",duplex:1,color_mode:"monochrome"
  },"/tmp/job.pdf"),[
    "-d","Office_Printer","-n","2","-o","media=A4","-o","sides=two-sided-long-edge","-o","ColorModel=Gray","/tmp/job.pdf"
  ]);
});

test("hash and mime helpers are deterministic",()=>{
  assert.equal(sha256(Buffer.from("printerly")),"310b2dadb150fea606f2b2cb1c9747897e7b68de10887221bc46c163d9fa1ac2");
  assert.equal(extensionForMime("application/pdf"),".pdf");
  assert.equal(extensionForMime("image/jpeg"),".jpg");
});
