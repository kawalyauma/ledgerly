import test from "node:test";
import assert from "node:assert/strict";
import {buildLpArgs,buildScanArgs,extensionForMime,parseCupsCompletedSheets,parseLpRequestId,parsePrinterHealth,parseSaneDevices,sha256} from "../src/lib.mjs";

test("parses the CUPS request id",()=>assert.equal(parseLpRequestId("request id is Office_Printer-148 (1 file(s))"),"Office_Printer-148"));
test("builds safe lp arguments",()=>assert.deepEqual(buildLpArgs({printer_system_name:"Office_Printer",copies:2,page_size:"A4",duplex:1,color_mode:"monochrome"},"/tmp/job.pdf"),["-d","Office_Printer","-n","2","-o","media=A4","-o","sides=two-sided-long-edge","-o","ColorModel=Gray","/tmp/job.pdf"]));
test("hash and HTML extension helpers are deterministic",()=>{assert.equal(sha256(Buffer.from("printerly")),"310b2dadb150fea606f2b2cb1c9747897e7b68de10887221bc46c163d9fa1ac2");assert.equal(extensionForMime("text/html"),".html")});
test("parses SANE scanner discovery without shell interpolation",()=>assert.deepEqual(parseSaneDevices("device `epson2:libusb:001:004' is a Epson flatbed scanner"),[{systemName:"epson2:libusb:001:004",name:"a Epson flatbed scanner",status:"ready",capabilities:{sane:true}}]));
test("builds scanner arguments as an argv array",()=>assert.deepEqual(buildScanArgs({scanner_system_name:"pixma:04A91732_123",resolution_dpi:300,color_mode:"gray",source:"flatbed",page_size:"A4"}),["--device-name","pixma:04A91732_123","--resolution","300","--mode","Gray","--source","Flatbed","-x","210","-y","297","--format=png"]));
test("extracts CUPS health and completed page counts",()=>{assert.deepEqual(parsePrinterHealth("printer disabled - media-empty; toner-low"),["stopped","media-empty","toner-low"]);assert.equal(parseCupsCompletedSheets("Pages: 18"),18)});
