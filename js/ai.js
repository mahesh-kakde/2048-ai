const PROB_THRESHOLD = 0.0001;

// deterministic splitmix64 prng for 64-bit zobrist table generation
let prng_seed = 0x853c49e6748fea9bn;
function splitmix64() {
  prng_seed = (prng_seed + 0x9e3779b97f4a7c15n) & 0xFFFFFFFFFFFFFFFFn;
  let z = prng_seed;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & 0xFFFFFFFFFFFFFFFFn;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & 0xFFFFFFFFFFFFFFFFn;
  return (z ^ (z >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
}

const MAX_ZOBRIST_EXP = 32;

// 16 cells x 32 tile exponent values (0..31)
const ZOBRIST_TABLE = [];
for (let pos = 0; pos < 16; pos++) {
  const row = [];
  for (let exp = 0; exp < MAX_ZOBRIST_EXP; exp++) {
    row.push(splitmix64());
  }
  ZOBRIST_TABLE.push(row);
}

function compute_zobrist_hash(board) {
  let h = 0n;
  let idx = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r][c];
      let exp = v > 0 ? Math.round(Math.log2(v)) : 0;
      if (exp < 0) exp = 0;
      if (exp >= MAX_ZOBRIST_EXP) exp = MAX_ZOBRIST_EXP - 1;
      h ^= ZOBRIST_TABLE[idx][exp];
      idx++;
    }
  }
  return h;
}

// 131,072 entries (2^17) direct-mapped transposition table
const TT_SIZE = 131072;
const TT_MASK = 131071n;

const tt_keys = new BigUint64Array(TT_SIZE);
const tt_depths = new Int8Array(TT_SIZE);
const tt_values = new Float64Array(TT_SIZE);
const tt_age = new Uint8Array(TT_SIZE);

let current_search_age = 0;
let tt_hits_count = 0;
let nodes_evaluated = 0;
let last_move_time_ms = 0;
let last_search_depth = 3;

let last_directional_telemetry = {
  up: null,
  right: null,
  down: null,
  left: null,
  best_dir: -1,
  raw: [null, null, null, null]
};

const EMBEDDED_WASM_B64 = "AGFzbQEAAAABQAtgAAF/YAF/AXxgAX8Bf2ACf38Bf2AEf39/fwF/YAN/f3wBfGAAAXxgAn5/AX9gAn9/AXxgA39/fwF/YAJ/fwADFxYAAQACAwQFBgEHCAkCAQAAAAMDBQoCBAUBcAEBAQUDAQBhBgkBfwFBgIDAAAsH6AENBm1lbW9yeQIACXdhc21faW5pdAAAEndhc21fZ2V0X2JvYXJkX3B0cgACD3dhc21fc2VhcmNoX2J1ZgADEXdhc21fZXZhbHVhdGVfYnVmAAcLd2FzbV9zZWFyY2gACRN3YXNtX2V2YWx1YXRlX2JvYXJkAAoRd2FzbV9zZWFyY2hfcGFydHMACxF3YXNtX2lzX2Rpcl92YWxpZAAMEHdhc21fZ2V0X2Rpcl92YWwADQ53YXNtX2dldF9ub2RlcwAOEHdhc21fZ2V0X3R0X2hpdHMADxF3YXNtX2dldF9iZXN0X2RpcgAQCvZaFsoJBAh/AXwBfwN+I4CAgIAAQSBrIgAkgICAgAAgAEEQakEEciEBQQAhAgNAIAJBA3QiAyACQQx0QYCAgPgAcSACQQ9xIgRyIAJBCHRBgIA8cSIFciACQQR0QYAecSIGchCBgICAADkDkIDAgAACQAJAIAQNACAAQRBqIQRBACEHDAELIAAgBDYCEEEBIQcgASEECwJAIAZFDQAgBCAGQQh2NgIAIAdBAWohBwsCQCAFRQ0AIABBEGogB0ECdHIgBUEQdjYCACAHQQFqIQcLAkACQAJAIAJBDHYiBEUNACAAQRBqIAdBAnRqIAQ2AgAgAEIANwMIIABCADcDACAHQQFqIQcMAQsgAEIANwMIIABCADcDACAHDQBBACEERAAAAAAAAAAAIQgMAQtEAAAAAAAAAAAhCEEAIQQgACEFA0AgAEEQaiAEQQJ0aigCACEGAkACQCAEQQFqIgkgB04NACAGIABBEGogCUECdGooAgBHDQAgBSAGQf4BIAZB/gFIG0EBaiIJNgIAIAhCASAJrYa6oCAIIAZBNEgbIQggBEECaiEEDAELIAUgBjYCACAJIQQLIAVBBGohBSAEIAdIDQALIAAoAgRBCHQgACgCAHIgACgCCEEQdHIgACgCDEEYdHIhBAsgAyAIOQOQgPCAACACQQJ0IAQ2ApCA4IAAIAJBAWoiAkGAgARHDQALQQAhBEGQgJCBACEFQZCAoIEAIQYDQCAGIARBBHRBgB5xIARBDHRyIARBBHZB8AFxciAEQYDgA3FBDHZyQf//A3EiCUEDdCsDkIDwgAA5AwAgBSAJQQJ0KAKQgOCAACIJQf+B/AdxQQh4IAlBGHhB/4H8B3FyNgIAIAZBCGohBiAFQQRqIQUgBEEBaiIEQYCABEcNAAtCm9W/pOe8kp6FfyEKQQAhCUGQgMCBACEGA0BBACEEA0AgBiAEaiIFQQhqIAoiC0Kq8NP0r+68tzx8IgpCHoggCoVCucuT59Htkay/f34iDEIbiCAMhULro8SZsbeS6JR/fiIMQh+IIAyFNwMAIAUgC0KV+Kn6l7fem55/fCILQh6IIAuFQrnLk+fR7ZGsv39+IgtCG4ggC4VC66PEmbG3kuiUf34iC0IfiCALhTcDACAEQRBqIgRBgAJHDQALIAZBgAJqIQYgCUEBaiIJQRBHDQALQYCAwH4hBANAIARB6KCAgwBqQQA7AQAgBEHgoICDAGpCADcDACAEQdiggIMAakIANwMAIARB0KCAgwBqQQA7AQAgBEHIoICDAGpCADcDACAEQcCggIMAakIANwMAIARBuKCAgwBqQQA7AQAgBEGwoICDAGpCADcDACAEQaiggIMAakIANwMAIARBoKCAgwBqQQA7AQAgBEGYoICDAGpCADcDACAEQZCggIMAakIANwMAIARB4ABqIgQNAAtBAELqmYLNk8vPlEY3A7CggIMAQQBCADcDoKCAgwBBAELqmYLNk8vPlEY3A7iggIMAQQBC6pmCzZPLz5RGNwPAoICDAEEAQgA3A6iggIMAQQBC6pmCzZPLz5RGNwPIoICDAEEAQQE6ANCggIMAQQBBADYClKCAgwBBAEEAOgCQoICDAEEAQQA2ApiggIMAIABBIGokgICAgABBAQvIAwMCfAF/A3xEAAAAAAAAAAAhAUQAAAAAAAAAACECAkAgAEH/AXEiA0UNACADuCEEAkAgA0EySQ0AIAREAAAAAAAAEEOiIQIMAQsgBEIBIAOthrqiIQILAkAgAEEIdkH/AXEiA0UNACADuCEBAkAgA0EySQ0AIAFEAAAAAAAAEEOiIQEMAQsgAUIBIAOthrqiIQELRAAAAAAAAAAAIQVEAAAAAAAAAAAhBAJAIABBEHZB/wFxIgNFDQAgA7ghBAJAIANBMkkNACAERAAAAAAAABBDoiEEDAELIARCASADrYa6oiEECwJAIABBGHYiA0UNACADuCEFAkAgAEGAgICQA0kNACAFRAAAAAAAABBDoiEFDAELIAVCASADrYa6oiEFCyAEIAEgAiACIAIgAaAgAiABoUQAAAAAAAAoQKIgAiABZhugIgagIAYgAiABYRsgBiACRAAAAAAAAAAAZBsgASAEoCABIAShRAAAAAAAAChAoiABIARmG6AiAqAgAiABIARhGyACIAFEAAAAAAAAAABkGyAEIAWgIAQgBaFEAAAAAAAAKECiIAQgBWYboCIBoCABIAQgBWEbIAEgBEQAAAAAAAAAAGQbCwgAQeCggIMAC14CAX8CfiOAgICAAEEgayIBJICAgIAAIAFBACkD4KCAgwAiAjcDECABQQApA+iggIMAIgM3AxggASACNwMAIAEgAzcDCCABIAAQhICAgAAhACABQSBqJICAgIAAIAALtwgCAn8DfCOAgICAAEGgAWsiAiSAgICAAAJAQQAtANCggIMADQAQgICAgAAaC0EAQX82AoCAwIAAQQBBAC0AkKCAgwBBAWo6AJCggIMAQQBBADYCmKCAgwBBAEEANgKUoICDACAALQAAIQMgAiAAKQMINwOAASACIAApAwA3A3ggAUF/aiEBAkACQCACQfgAakEAIAJBkAFqIAJBiAFqEIWAgIAADQBBAELqmYLNk8vPlEY3A7CggIMAQQBBADYCoKCAgwBE6oygOVk+KcYhBAwBCwJAAkAgA0EGSQ0ARAAAACBfoALCIQQgAi0AkAEgA0kNAQtEAAAAAAAAAAAhBAsgAiACKQOYATcDcCACIAIpA5ABNwNoIAJB6ABqIAFEAAAAAAAA8D8QhoCAgAAhBUEAQQE2AqCggIMAQQAgBCAFoCIFOQOwoICDAETqjKA5WT4pxiEEIAVE6oygOVk+KcZkRQ0AQQBBADYCgIDAgAAgBSEECyACIAApAwA3A1ggAiAAKQMINwNgAkACQCACQdgAakEDIAJBkAFqIAJBiAFqEIWAgIAARQ0AAkACQCADQQZJDQBEAAAAIF+gAsIhBSACLQCQASADSQ0BC0QAAAAAAAAAACEFCyACIAIpA5gBNwNQIAIgAikDkAE3A0ggAkHIAGogAUQAAAAAAADwPxCGgICAACEGQQBBATYCrKCAgwBBACAFIAagIgU5A8iggIMAIAUgBGRFDQFBAEEDNgKAgMCAACAFIQQMAQtBAELqmYLNk8vPlEY3A8iggIMAQQBBADYCrKCAgwALIAIgACkDADcDOCACIAApAwg3A0ACQAJAIAJBOGpBASACQZABaiACQYgBahCFgICAAEUNAAJAAkAgA0EGSQ0ARAAAACBfoALCIQUgAi0AkAEgA0kNAQtEAAAAAAAAAAAhBQsgAiACKQOYATcDMCACIAIpA5ABNwMoIAJBKGogAUQAAAAAAADwPxCGgICAACEGQQBBATYCpKCAgwBBACAFIAagIgU5A7iggIMAIAUgBGRFDQFBAEEBNgKAgMCAACAFIQQMAQtBAELqmYLNk8vPlEY3A7iggIMAQQBBADYCpKCAgwALIAIgACkDADcDGCACIAApAwg3AyACQAJAIAJBGGpBAiACQZABaiACQYgBahCFgICAAEUNAAJAAkAgA0EGSQ0ARAAAACBfoALCIQUgAi0AkAEgA0kNAQtEAAAAAAAAAAAhBQsgAiACKQOYATcDECACIAIpA5ABNwMIIAJBCGogAUQAAAAAAADwPxCGgICAACEGQQBBATYCqKCAgwBBACAFIAagIgU5A8CggIMAIAUgBGRFDQFBAEECNgKAgMCAAAwBC0EAQuqZgs2Ty8+URjcDwKCAgwBBAEEANgKooICDAAtBACgCgIDAgAAhACACQaABaiSAgICAACAAC4kLAwJ/B34DfyOAgICAAEEgayIEJICAgIAAQQAhBQJAAkACQAJAAkACQCABDgQCAQMABQsgACkDCCEGIAApAwAiB6cgBEEYahCRgICAACEFIAdCIIinIARBEGoQkYCAgAAhACAGpyAEQQhqEJGAgIAAIQEgBkIgiKcgBBCRgICAAK1CIIYgAa2EIQgCQCAHIACtQiCGIAWthCIJUg0AQQAhBSAIIAZRDQULIAIgCDcDCCACIAk3AwAgAyAEKwMYIAQrAxCgIAQrAwigIAQrAwCgOQMADAMLIAApAwghBiAAKQMAIgenIARBGGoQkoCAgAAhBSAHQiCIpyAEQRBqEJKAgIAAIQAgBqcgBEEIahCSgICAACEBIAZCIIinIAQQkoCAgACtQiCGIAGthCEIAkAgByAArUIghiAFrYQiCVINAEEAIQUgCCAGUQ0ECyACIAg3AwggAiAJNwMAIAMgBCsDGCAEKwMQoCAEKwMIoCAEKwMAoDkDAAwCCyAAKQMAIgZCGIhCgP4DgyAGQv8Bg4QgACkDCCIHQhCGQoCA/AeDhCAHQgiIQoCAgPgPg4QiCqcgBEEYahCRgICAACEAIAZCCIhC/wGDIAZCIIhCgP4Dg4QgB0IIhkKAgPwHg4QgB0IQiEKAgID4D4OEIgunIARBEGoQkYCAgAAhASAGQhCIQv8BgyAGQiiIQoD+A4OEIAdCgID8B4OEIAdCGIhCgICA+A+DhCIMpyAEQQhqEJGAgIAAIQ0gBkIwiKdBgP4DcSAGp0EYdnIgB6dBCHZBgID8B3FyIAdCIIinQYCAgHhxciIOIAQQkYCAgAAiD60hBiANrSEHAkAgAa0iCEIghiAArSIJhCAKIAtCIIaEUg0AIAZCIIYgB4QgDq1CIIYgDIRRDQMLIAMgBCsDGCAEKwMQoCAEKwMIoCAEKwMAoDkDACACIAhCCIhCgP4DgyAJQhCIQv8Bg4QgB0KAgPwHg4QgBkIIhkKAgID4D4OEIAFBEHZBgP4DcSAAQRh2ciANQQh2QYCA/AdxciAPQYCAgHhxcq1CIIaENwMIIAIgCEIIhkKA/gODIAlC/wGDhCAHQhCGQoCA/AeDhCAGQhiGQoCAgPgPg4QgCUIIiEL/AYMgCEKA/gODhCAHQgiGQoCA/AeDhCAGQhCGQoCAgPgPg4RCIIaENwMADAELIAApAwAiBkIYiEKA/gODIAZC/wGDhCAAKQMIIgdCEIZCgID8B4OEIAdCCIhCgICA+A+DhCIKpyAEQRhqEJKAgIAAIQAgBkIIiEL/AYMgBkIgiEKA/gODhCAHQgiGQoCA/AeDhCAHQhCIQoCAgPgPg4QiC6cgBEEQahCSgICAACEBIAZCEIhC/wGDIAZCKIhCgP4Dg4QgB0KAgPwHg4QgB0IYiEKAgID4D4OEIgynIARBCGoQkoCAgAAhDSAGQjCIp0GA/gNxIAanQRh2ciAHp0EIdkGAgPwHcXIgB0IgiKdBgICAeHFyIg4gBBCSgICAACIPrSEGIA2tIQcCQCABrSIIQiCGIACtIgmEIAogC0IghoRSDQAgBkIghiAHhCAOrUIghiAMhFENAgsgAyAEKwMYIAQrAxCgIAQrAwigIAQrAwCgOQMAIAIgCEIIiEKA/gODIAlCEIhC/wGDhCAHQoCA/AeDhCAGQgiGQoCAgPgPg4QgAUEQdkGA/gNxIABBGHZyIA1BCHZBgID8B3FyIA9BgICAeHFyrUIghoQ3AwggAiAIQgiGQoD+A4MgCUL/AYOEIAdCEIZCgID8B4OEIAZCGIZCgICA+A+DhCAJQgiIQv8BgyAIQoD+A4OEIAdCCIZCgID8B4OEIAZCEIZCgICA+A+DhEIghoQ3AwALQQEhBQsgBEEgaiSAgICAACAFC+MJBwF/AX4CfwF+A3wCfwJ+I4CAgIAAQZABayIDJICAgIAAAkACQCAAKQMAIgRC/wGDQgBRDQBBACEFIANB0ABqIQYMAQsgA0EANgJQIANB0ABqQQRyIQZBASEFCwJAIARCgP4Dg0IAUg0AIAZBATYCACAFQQFqIQULAkAgBEKAgPwHg0IAUg0AIANB0ABqIAVBAnRyQQI2AgAgBUEBaiEFCwJAIARCgICA+A+DQgBSDQAgA0HQAGogBUECdGpBAzYCACAFQQFqIQULAkAgBEKAgICA8B+DQgBSDQAgA0HQAGogBUECdGpBBDYCACAFQQFqIQULAkAgBEKAgICAgOA/g0IAUg0AIANB0ABqIAVBAnRqQQU2AgAgBUEBaiEFCwJAIARCgICAgICAwP8Ag0IAUg0AIANB0ABqIAVBAnRqQQY2AgAgBUEBaiEFCyAAKQMIIQcCQCAEQv//////////AFYNACADQdAAaiAFQQJ0akEHNgIAIAVBAWohBQsCQCAHQv8Bg0IAUg0AIANB0ABqIAVBAnRqQQg2AgAgBUEBaiEFCwJAIAdCgP4Dg0IAUg0AIANB0ABqIAVBAnRqQQk2AgAgBUEBaiEFCwJAIAdCgID8B4NCAFINACADQdAAaiAFQQJ0akEKNgIAIAVBAWohBQsCQCAHQoCAgPgPg0IAUg0AIANB0ABqIAVBAnRqQQs2AgAgBUEBaiEFCwJAIAdCgICAgPAfg0IAUg0AIANB0ABqIAVBAnRqQQw2AgAgBUEBaiEFCwJAIAdCgICAgIDgP4NCAFINACADQdAAaiAFQQJ0akENNgIAIAVBAWohBQsCQCAHQoCAgICAgMD/AINCAFINACADQdAAaiAFQQJ0akEONgIAIAVBAWohBQsCQAJAAkAgB0L//////////wBWDQAgA0HQAGogBUECdGpBDzYCACAFQQFqIQUMAQsgBQ0AQQBBACgClKCAgwBBAWo2ApSggIMAIAMgACkDADcDMCADIAApAwg3AzggA0EwahCIgICAACECDAELIAIgBbijIgJEmpmZmZmZuT+iIQggAkTNzMzMzMzsP6IhCUQAAAAAAAAAACEKIANB0ABqIQZEAAAAAAAAAAAhAgNAIAYoAgAhCwJAIAlELUMc6+I2Gj9mRQ0AIAtBA3QhDAJAAkAgC0EHSg0AQgEgDK2GIASEIQ0gByEODAELQgEgDEFAaq2GIAeEIQ4gBCENCyADIA43A0ggAyANNwNAIAMgDTcDICADIA43AyggAkTNzMzMzMzsP6AhAiADQSBqIAEgCRCTgICAAETNzMzMzMzsP6IgCqAhCgsCQCAIRC1DHOviNho/ZkUNACALQQN0IQwCQAJAIAtBB0oNAEICIAythiAEhCENIAchDgwBC0ICIAxBQGqthiAHhCEOIAQhDQsgAyAONwNIIAMgDTcDQCADIA03AxAgAyAONwMYIAJEmpmZmZmZuT+gIQIgA0EQaiABIAgQk4CAgABEmpmZmZmZuT+iIAqgIQoLIAZBBGohBiAFQX9qIgUNAAsCQCACRAAAAAAAAAAAZEUNACAKIAKjIQIMAQtBAEEAKAKUoICDAEEBajYClKCAgwAgAyAAKQMANwMAIAMgACkDCDcDCCADEIiAgIAAIQILIANBkAFqJICAgIAAIAILcwMBfwJ+AXwjgICAgABBIGsiACSAgICAAAJAQQAtANCggIMADQAQgICAgAAaCyAAQQApA+CggIMAIgE3AxAgAEEAKQPooICDACICNwMYIAAgATcDACAAIAI3AwggABCIgICAACEDIABBIGokgICAgAAgAwvvBwsLfgF/AXwBfwF8An8BfAJ/AXwBfwR8IAApAwgiAUIgiCECIAApAwAiA0IoiCEEIANCEIghBSADQiCIIgZCgP4DgyEHIANCCIhC/wGDIQggAUIIhiEJIANCGIhCgP4DgyADQv8Bg4QhCiABQhCGQoCA/AeDIQsgBqchAAJAAkAgA6ciDEHw4cOHf3ENACAMQQR2QfABcSAMQQ9xckEDdCAMQQV2QYDwAXFyIAxBCXZBgIAecXIrA5CAwIAAIQ0MAQsgDBCBgICAACENCyABpyEOIANCMIghAyAEQoD+A4MhBCAFQv8BgyEFIAggB4QhBiAJQoCA/AeDIQcgAUIQiCEIIAogC4QhCSACQhiGIQoCQAJAIABB8OHDh39xDQAgAEEEdkHwAXEgAEEPcXJBA3QgAEEFdkGA8AFxciAAQQl2QYCAHnFyKwOQgMCAACEPDAELIAAQgYCAgAAhDwsgDkEIdiEQIAOnIREgAqchACAFIASEIQMgAUKAgPwHgyECIAFCGIghASAGIAeEIQQgCEKAgID4D4MhBSAJIAqEIQYCQAJAIA5B8OHDh39xDQAgDkEEdkHwAXEgDkEPcXIgEEGAHnFyQQN0IA5BCXZBgIAecXIrA5CAwIAAIRIMAQsgDhCBgICAACESCyAQQYCA/AdxIRMgEUGA/gNxIRQgAyAChCEDIAFCgICA+A+DIQEgBCAFhCECIAanIRACQAJAIABB8OHDh39xDQAgAEEEdkHwAXEgAEEPcXJBA3QgAEEFdkGA8AFxciAAQQl2QYCAHnFyKwOQgMCAACEVDAELIAAQgYCAgAAhFQsgFCATciEUIABBgICAeHEhFiADIAGEIQMgAqchEwJAAkAgEEHw4cOHf3ENACAQQQR2QfABcSAQQQ9xckEDdCAQQQV2QYDwAXFyIBBBCXZBgIAecXIrA5CAwIAAIRcMAQsgEBCBgICAACEXCyAUIBZyIRAgDEEYdiEUIAOnIQwCQAJAIBNB8OHDh39xDQAgE0EEdkHwAXEgE0EPcXJBA3QgE0EFdkGA8AFxciATQQl2QYCAHnFyKwOQgMCAACEYDAELIBMQgYCAgAAhGAsgECAUciEQAkACQCAMQfDhw4d/cQ0AIAxBBHZB8AFxIAxBD3FyQQN0IAxBBXZBgPABcXIgDEEJdkGAgB5xcisDkIDAgAAhGQwBCyAMEIGAgIAAIRkLAkACQCAQQfDhw4d/cQ0AIBFBBHZB8AFxIBRBD3FyQQN0IA5BDXZBgPABcXIgAEEJdkGAgB5xcisDkIDAgAAhGgwBCyAQEIGAgIAAIRoLIA0gD6AgEqAgFaAgF6AgGKAgGaAgGqALmQICAX8BfiOAgICAAEEgayICJICAgIAAIAIgAEIgiEIPgyAAQhyIQoAeg4QgAEIYiEKAgDyDhCAAQhSIQoCAgPgAg4QgAEIQiEKAgICA8AGDhCAAQgyIQoCAgICA4AODhCAAQgiIQoCAgICAgMAHg4QgAEIEiEKAgICAgICAgA+DhCIDNwMYIAIgAEIEhkKAHoMgAEIPg4QgAEIIhkKAgDyDhCAAQgyGQoCAgPgAg4QgAEIQhkKAgICA8AGDhCAAQhSGQoCAgICA4AODhCAAQhiGQoCAgICAgMAHg4QgAEIchkKAgICAgICAgA+DhCIANwMQIAIgADcDACACIAM3AwggAiABEISAgIAAIQEgAkEgaiSAgICAACABC7ECAwF/An4BfCOAgICAAEEgayICJICAgIAAAkBBAC0A0KCAgwANABCAgICAABoLIAIgAa0iA0IEhkKAHoMgA0IPg4QgA0IIhkKAgDyDhCADQgyGQoCAgPgAg4QgA0IQhkKAgICA8AGDhCADQhSGQoCAgICA4AODhCADQhiGQoCAgICAgMAHg4QgA0IchkKAgICAgICAgA+DhCIENwMYIAIgAK0iA0IEhkKAHoMgA0IPg4QgA0IIhkKAgDyDhCADQgyGQoCAgPgAg4QgA0IQhkKAgICA8AGDhCADQhSGQoCAgICA4AODhCADQhiGQoCAgICAgMAHg4QgA0IchkKAgICAgICAgA+DhCIDNwMQIAIgAzcDACACIAQ3AwggAhCIgICAACEFIAJBIGokgICAgAAgBQucAgIBfwJ+I4CAgIAAQSBrIgMkgICAgAAgAyABrSIEQgSGQoAegyAEQg+DhCAEQgiGQoCAPIOEIARCDIZCgICA+ACDhCAEQhCGQoCAgIDwAYOEIARCFIZCgICAgIDgA4OEIARCGIZCgICAgICAwAeDhCAEQhyGQoCAgICAgICAD4OEIgU3AxggAyAArSIEQgSGQoAegyAEQg+DhCAEQgiGQoCAPIOEIARCDIZCgICA+ACDhCAEQhCGQoCAgIDwAYOEIARCFIZCgICAgIDgA4OEIARCGIZCgICAgICAwAeDhCAEQhyGQoCAgICAgICAD4OEIgQ3AxAgAyAENwMAIAMgBTcDCCADIAIQhICAgAAhASADQSBqJICAgIAAIAELIgEBf0EAIQECQCAAQQNLDQAgAEECdCgCoKCAgwAhAQsgAQspAQF8ROqMoDlZPinGIQECQCAAQQNLDQAgAEEDdCsDsKCAgwAhAQsgAQsLAEEAKAKUoICDAAsLAEEAKAKYoICDAAsLAEEAKAKAgMCAAAuEBAMEfwF8AX8jgICAgABBIGshAgJAIABB8OHDh39xDQAgASAAQQR2QfABcSAAQQ9xciAAQQh2QYAecXIgAEEMdkGA4ANxciIAQQN0KwOQgPCAADkDACAAQQJ0KAKQgOCAAA8LAkACQCAAQf8BcSIDDQBBACEEIAJBEGohAwwBCyACIAM2AhAgAkEQakEEciEDQQEhBAsCQCAAQQh2Qf8BcSIFRQ0AIAMgBTYCACAEQQFqIQQLAkAgAEEQdkH/AXEiA0UNACACQRBqIARBAnRyIAM2AgAgBEEBaiEECwJAAkAgAEEYdiIARQ0AIAJBEGogBEECdGogADYCACACQgA3AwggAkIANwMAIARBAWohBAwBCyACQgA3AwggAkIANwMAIAQNACABRAAAAAAAAAAAOQMAQQAPC0QAAAAAAAAAACEGQQAhACACIQMDQCACQRBqIABBAnRqKAIAIQUCQAJAIABBAWoiByAETg0AIAUgAkEQaiAHQQJ0aigCAEcNACADIAVB/gEgBUH+AUgbQQFqIgc2AgAgBkIBIAethrqgIAYgBUE0SBshBiAAQQJqIQAMAQsgAyAFNgIAIAchAAsgA0EEaiEDIAAgBEgNAAsgAigCCCEAIAIoAgQhAyACKAIAIQUgAigCDCEHIAEgBjkDACAFIANBCHRyIABBEHRyIAdBGHRyC7IEAwR/AXwBfyOAgICAAEEgayECAkAgAEHw4cOHf3ENACABIABBBHZB8AFxIABBD3FyIABBCHZBgB5xciAAQQx2QYDgA3FyIgBBA3QrA5CAoIEAOQMAIABBAnQoApCAkIEADwsCQAJAIABB/4H8B3FBCHggAEEYeEH/gfwHcXIiAEH/AXEiAw0AQQAhBCACQRBqIQMMAQsgAiADNgIQIAJBEGpBBHIhA0EBIQQLAkAgAEEIdkH/AXEiBUUNACADIAU2AgAgBEEBaiEECwJAIABBEHZB/wFxIgNFDQAgAkEQaiAEQQJ0ciADNgIAIARBAWohBAsCQAJAIABBGHYiAEUNACACQRBqIARBAnRqIAA2AgAgAkIANwMIIAJCADcDACAEQQFqIQQMAQsgAkIANwMIIAJCADcDACAEDQAgAUQAAAAAAAAAADkDAEEADwtEAAAAAAAAAAAhBkEAIQAgAiEDA0AgAkEQaiAAQQJ0aigCACEFAkACQCAAQQFqIgcgBE4NACAFIAJBEGogB0ECdGooAgBHDQAgAyAFQf4BIAVB/gFIG0EBaiIHNgIAIAZCASAHrYa6oCAGIAVBNEgbIQYgAEECaiEADAELIAMgBTYCACAHIQALIANBBGohAyAAIARIDQALIAIoAgghACACKAIEIQMgAigCACEFIAIoAgwhByABIAY5AwAgBSADQQh0ciAAQRB0ciAHQRh0ciIAQf+B/AdxQQh4IABBGHhB/4H8B3FyC64UBgF/AX4EfwF8EH4BfCOAgICAAEHQAWsiAySAgICAAAJAAkACQCABQQFIDQAgACkDACIEpyIFQRh2IgZFDQEgBUEQdkH/AXEiB0UNASAFQf8BcSIIRQ0BIAVBCHZB/wFxIgVFDQEgByAGRg0BIAggBUYNASAFIAdGDQEgBEI4iKciB0UNASAEQjCIp0H/AXEiBUUNASAEQiCIp0H/AXEiCEUNASAEQiiIp0H/AXEiBkUNASAFIAdGDQEgCCAGRg0BIAYgBUYNASAAKQMIIgSnIgVBGHYiBkUNASAFQRB2Qf8BcSIHRQ0BIAVB/wFxIghFDQEgBUEIdkH/AXEiBUUNASAHIAZGDQEgCCAFRg0BIAUgB0YNASAEQjiIpyIHRQ0BIARCMIinQf8BcSIFRQ0BIARCIIinQf8BcSIIRQ0BIARCKIinQf8BcSIGRQ0BIAUgB0YNASAIIAZGDQEgBiAFRg0BIAMgACkDADcDqAEgAyAAKQMINwOwASADQcABaiADQagBahCUgICAACADKQPAASIEpxCVgICAAA0BIARCIIinEJWAgIAADQEgAykDyAEiBKcQlYCAgAANASAEQiCIpxCVgICAAA0BC0EAQQAoApSggIMAQQFqNgKUoICDACADIAApAwA3AwggAyAAKQMINwMQIANBCGoQiICAgAAhCQwBCwJAAkAgACkDACIEp0H/AXEiB0EfSw0AIAdBA3QpA5CAwIEAIQoMAQtBACkDiILAgQAgBEL/AYNClfip+pe33puef36FIQoLAkACQCAEQgiIIgunQf8BcSIFQSBJDQBBACkDiITAgQAgC0L/AYNClfip+pe33puef36FIQsMAQsgBUEDdCkDkILAgQAhCwsCQAJAIARCEIgiDKdB/wFxIgVBIEkNAEEAKQOIhsCBACAMQv8Bg0KV+Kn6l7fem55/foUhDAwBCyAFQQN0KQOQhMCBACEMCwJAAkAgBEIYiCINp0H/AXEiBUEgSQ0AQQApA4iIwIEAIA1C/wGDQpX4qfqXt96bnn9+hSENDAELIAVBA3QpA5CGwIEAIQ0LAkACQCAEQiCIIg6nQf8BcSIFQSBJDQBBACkDiIrAgQAgDkL/AYNClfip+pe33puef36FIQ4MAQsgBUEDdCkDkIjAgQAhDgsCQAJAIARCKIgiD6dB/wFxIgVBIEkNAEEAKQOIjMCBACAPQv8Bg0KV+Kn6l7fem55/foUhDwwBCyAFQQN0KQOQisCBACEPCwJAAkAgBEIwiCIQp0H/AXEiBUEgSQ0AQQApA4iOwIEAIBBC/wGDQpX4qfqXt96bnn9+hSEQDAELIAVBA3QpA5CMwIEAIRALIARCOIghEQJAAkAgBEKAgICAgICAgCBUDQBBACkDiJDAgQAgEUKV+Kn6l7fem55/foUhEQwBCyARp0EDdCkDkI7AgQAhEQsCQAJAIAApAwgiBKdB/wFxIgVBH0sNACAFQQN0KQOQkMCBACESDAELQQApA4iSwIEAIARC/wGDQpX4qfqXt96bnn9+hSESCwJAAkAgBEIIiCITp0H/AXEiBUEgSQ0AQQApA4iUwIEAIBNC/wGDQpX4qfqXt96bnn9+hSETDAELIAVBA3QpA5CSwIEAIRMLAkACQCAEQhCIIhSnQf8BcSIFQSBJDQBBACkDiJbAgQAgFEL/AYNClfip+pe33puef36FIRQMAQsgBUEDdCkDkJTAgQAhFAsCQAJAIARCGIgiFadB/wFxIgVBIEkNAEEAKQOImMCBACAVQv8Bg0KV+Kn6l7fem55/foUhFQwBCyAFQQN0KQOQlsCBACEVCwJAAkAgBEIgiCIWp0H/AXEiBUEgSQ0AQQApA4iawIEAIBZC/wGDQpX4qfqXt96bnn9+hSEWDAELIAVBA3QpA5CYwIEAIRYLAkACQCAEQiiIIhenQf8BcSIFQSBJDQBBACkDiJzAgQAgF0L/AYNClfip+pe33puef36FIRcMAQsgBUEDdCkDkJrAgQAhFwsCQAJAIARCMIgiGKdB/wFxIgVBIEkNAEEAKQOInsCBACAYQv8Bg0KV+Kn6l7fem55/foUhGAwBCyAFQQN0KQOQnMCBACEYCyAEQjiIIRkCQAJAIARCgICAgICAgIAgVA0AQQApA4igwIEAIBlClfip+pe33puef36FIQQMAQsgGadBA3QpA5CewIEAIQQLIAsgCoUgDIUgDYUgDoUgD4UgEIUgEYUgEoUgE4UgFIUgFYUgFoUgF4UgGIUgBIUiBKdB//8HcUEYbCIGQZCgwIEAaiEFAkAgBikDkKDAgQAgBFINACABIAUsABBKDQBBAEEAKAKYoICDAEEBajYCmKCAgwAgBSsDCCEJDAELIAMgACkDADcDmAEgAyAAKQMINwOgASABQX9qIQZBACEIAkACQCADQZgBakEAIANBwAFqIANBuAFqEIWAgIAADQBE6oygOVk+KcYhCQwBCwJAAkAgB0EGSQ0ARAAAACBfoALCIQkgAy0AwAEgB0kNAQtEAAAAAAAAAAAhCQsgAyADKQPIATcDkAEgAyADKQPAATcDiAEgCSADQYgBaiAGIAIQhoCAgACgIglE6oygOVk+KcYgCUTqjKA5WT4pxmQbIQlBASEICyADIAApAwA3A3ggAyAAKQMINwOAAQJAIANB+ABqQQMgA0HAAWogA0G4AWoQhYCAgABFDQACQAJAIAdBBkkNAEQAAAAgX6ACwiEaIAMtAMABIAdJDQELRAAAAAAAAAAAIRoLIAMgAykDyAE3A3AgAyADKQPAATcDaCAaIANB6ABqIAYgAhCGgICAAKAiGiAJIBogCWQbIQlBASEICyADIAApAwA3A1ggAyAAKQMINwNgAkAgA0HYAGpBASADQcABaiADQbgBahCFgICAAEUNAAJAAkAgB0EGSQ0ARAAAACBfoALCIRogAy0AwAEgB0kNAQtEAAAAAAAAAAAhGgsgAyADKQPIATcDUCADIAMpA8ABNwNIIBogA0HIAGogBiACEIaAgIAAoCIaIAkgGiAJZBshCUEBIQgLIAMgACkDADcDOCADIAApAwg3A0ACQAJAIANBOGpBAiADQcABaiADQbgBahCFgICAAEUNAAJAAkAgB0EGSQ0ARAAAACBfoALCIRogAy0AwAEgB0kNAQtEAAAAAAAAAAAhGgsgAyADKQPIATcDMCADIAMpA8ABNwMoIBogA0EoaiAGIAIQhoCAgACgIgIgCSACIAlkGyEJDAELIAgNACADIAApAwg3AyAgAyAAKQMANwMYIANBGGoQiICAgAAhCQsCQCAFKQMAIARSDQAgASAFLAAQSA0BIAUgCTkDCCAFIAE6ABAgBUEALQCQoICDADoAEQwBCwJAIAUtABFBAC0AkKCAgwAiAEcNACABIAUsABBIDQELIAUgAToAECAFIAQ3AwAgBSAAOgARIAUgCTkDCAsgA0HQAWokgICAgAAgCQvOAQECfiAAIAEpAwAiAkIYiEKA/gODIAJC/wGDhCABKQMIIgNCEIZCgID8B4OEIANCCIhCgICA+A+DhCACQgiIQv8BgyACQiCIQoD+A4OEIANCCIZCgID8B4OEIANCEIhCgICA+A+DhEIghoQ3AwAgACACQhCIQv8BgyACQiiIQoD+A4OEIANCgID8B4OEIANCGIhCgICA+A+DhCACQjCIp0GA/gNxIAKnQRh2ciADp0EIdkGAgPwHcXIgA0IgiKdBgICAeHFyrUIghoQ3AwgLUQEEf0EBIQECQCAAQRh2IgJFDQAgAEEQdkH/AXEiA0UNACAAQf8BcSIERQ0AIABBCHZB/wFxIgBFDQAgAyACRiAEIABGIAAgA0ZyciEBCyABCwsNAQBBgIDAAAsE/////w==";

const WASM_BINARY_PATH = 'wasm/engine.dd991401.wasm';

let wasm_exports = null;
let wasm_ready = false;
let wasm_init_promise = null;

async function init_wasm() {
  if (wasm_ready) return true;
  if (wasm_init_promise) return wasm_init_promise;

  wasm_init_promise = (async () => {
    try {
      let bytes = null;
      try {
        const response = await fetch(WASM_BINARY_PATH);
        if (response.ok) {
          bytes = await response.arrayBuffer();
        }
      } catch (_) {}

      if (!bytes && typeof EMBEDDED_WASM_B64 === 'string' && EMBEDDED_WASM_B64.length > 0) {
        const bin_str = atob(EMBEDDED_WASM_B64);
        const len = bin_str.length;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          u8[i] = bin_str.charCodeAt(i);
        }
        bytes = u8.buffer;
      }

      if (!bytes) {
        throw new Error('wasm binary not available');
      }

      const { instance } = await WebAssembly.instantiate(bytes, {});
      wasm_exports = instance.exports;
      if (wasm_exports.wasm_init) {
        wasm_exports.wasm_init();
      }
      wasm_ready = true;
      return true;
    } catch (err) {
      console.warn('wasm search engine unavailable, using javascript fallback:', err);
      wasm_ready = false;
      return false;
    }
  })();

  return wasm_init_promise;
}

if (typeof window !== 'undefined') {
  init_wasm();
}

function get_search_depth_wasm(board) {
  const empty = get_empty_cells(board).length;
  return empty <= 4 ? 6 : 5;
}

function encode_board_bitboard(board) {
  return board_to_bitboard(board);
}

function rank_tile_score(r) {
  return r === 0 ? 0 : (r * Math.pow(2, r));
}

function eval_line_exps(c0, c1, c2, c3) {
  const a0 = rank_tile_score(c0);
  const a1 = rank_tile_score(c1);
  const a2 = rank_tile_score(c2);
  const a3 = rank_tile_score(c3);

  // descending (left to right)
  let score_desc = a0;
  score_desc += (a0 >= a1) ? (a0 + a1) : ((a0 - a1) * 12);
  if (a0 === a1 && a0 > 0) score_desc += a0;
  score_desc += (a1 >= a2) ? (a1 + a2) : ((a1 - a2) * 12);
  if (a1 === a2 && a1 > 0) score_desc += a1;
  score_desc += (a2 >= a3) ? (a2 + a3) : ((a2 - a3) * 12);
  if (a2 === a3 && a2 > 0) score_desc += a2;
  return score_desc;
}

const SCORE_MAP_DESC = new Float64Array(65536);

for (let i = 0; i < 65536; i++) {
  SCORE_MAP_DESC[i] = eval_line_exps(i & 0xF, (i >> 4) & 0xF, (i >> 8) & 0xF, (i >> 12) & 0xF);
}

function cell_exp(v) {
  return v > 0 ? Math.round(Math.log2(v)) : 0;
}

function eval_line_fast(e0, e1, e2, e3) {
  const mask = e0 | e1 | e2 | e3;
  if (mask >= 0 && mask < 16) {
    return SCORE_MAP_DESC[e0 | (e1 << 4) | (e2 << 8) | (e3 << 12)];
  }
  return eval_line_exps(e0, e1, e2, e3);
}

function evaluate_board(board) {
  let total_score = 0;
  for (let r = 0; r < 4; r++) {
    total_score += eval_line_fast(
      cell_exp(board[r][0]),
      cell_exp(board[r][1]),
      cell_exp(board[r][2]),
      cell_exp(board[r][3])
    );
  }

  for (let c = 0; c < 4; c++) {
    total_score += eval_line_fast(
      cell_exp(board[0][c]),
      cell_exp(board[1][c]),
      cell_exp(board[2][c]),
      cell_exp(board[3][c])
    );
  }

  return total_score;
}

const heuristic_evaluate = evaluate_board;

function get_search_depth(board) {
  const empty = get_empty_cells(board).length;
  return empty <= 4 ? 4 : 3;
}

const ANCHOR_PENALTY = 1e10;

function expectimax_max(board, depth, prob) {
  if (depth <= 0 || is_game_over(board)) {
    nodes_evaluated++;
    return evaluate_board(board);
  }

  const hash = compute_zobrist_hash(board);
  const tt_idx = Number(hash & TT_MASK);

  if (tt_keys[tt_idx] === hash && tt_depths[tt_idx] >= depth) {
    tt_hits_count++;
    return tt_values[tt_idx];
  }

  let best = -Infinity;
  let has_valid_move = false;

  const search_dirs = [0, 3, 1, 2];
  for (let i = 0; i < 4; i++) {
    const dir = search_dirs[i];
    const res = move(board, dir);
    if (!res.moved) continue;
    has_valid_move = true;

    const penalty = (typeof check_anchor_violation === 'function' && check_anchor_violation(board, res.board)) ? -ANCHOR_PENALTY : 0;
    const val = penalty + expectimax_chance(res.board, depth - 1, prob);
    if (val > best) best = val;
  }

  const final_val = has_valid_move ? best : evaluate_board(board);

  if (tt_keys[tt_idx] === hash) {
    if (depth >= tt_depths[tt_idx]) {
      tt_depths[tt_idx] = depth;
      tt_values[tt_idx] = final_val;
      tt_age[tt_idx] = current_search_age;
    }
  } else if (tt_age[tt_idx] !== current_search_age || depth >= tt_depths[tt_idx]) {
    tt_keys[tt_idx] = hash;
    tt_depths[tt_idx] = depth;
    tt_values[tt_idx] = final_val;
    tt_age[tt_idx] = current_search_age;
  }

  return final_val;
}

function expectimax_chance(board, depth, prob) {
  const empty = get_empty_cells(board);
  if (empty.length === 0) {
    nodes_evaluated++;
    return evaluate_board(board);
  }

  let avg = 0.0;
  let weight_sum = 0.0;
  const cell_prob = prob / empty.length;

  for (let i = 0; i < empty.length; i++) {
    const [r, c] = empty[i];
    for (let t = 0; t < 2; t++) {
      const val = t === 0 ? 2 : 4;
      const tile_prob = t === 0 ? 0.9 : 0.1;
      const branch_prob = cell_prob * tile_prob;
      if (branch_prob < PROB_THRESHOLD) continue;

      const b = clone(board);
      b[r][c] = val;
      const child_val = expectimax_max(b, depth, branch_prob);
      avg += tile_prob * child_val;
      weight_sum += tile_prob;
    }
  }

  return weight_sum > 0 ? (avg / weight_sum) : evaluate_board(board);
}

function ai_best_move(board) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  nodes_evaluated = 0;
  tt_hits_count = 0;
  current_search_age = (current_search_age + 1) & 0xFF;

  // 1. wasm expectimax search (depth 5-6)
  if (wasm_ready && wasm_exports && wasm_exports.wasm_get_board_ptr && wasm_exports.wasm_search_buf && wasm_exports.memory) {
    const search_depth = get_search_depth_wasm(board);
    last_search_depth = search_depth;

    const ptr = wasm_exports.wasm_get_board_ptr();
    const buf = new Uint8Array(wasm_exports.memory.buffer, ptr, 16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        buf[r * 4 + c] = cell_exp(board[r][c]);
      }
    }

    const best_dir = wasm_exports.wasm_search_buf(search_depth);

    nodes_evaluated = wasm_exports.wasm_get_nodes ? wasm_exports.wasm_get_nodes() : 0;
    tt_hits_count = wasm_exports.wasm_get_tt_hits ? wasm_exports.wasm_get_tt_hits() : 0;

    const dir_values = [null, null, null, null];
    for (let d = 0; d < 4; d++) {
      const valid = wasm_exports.wasm_is_dir_valid
        ? wasm_exports.wasm_is_dir_valid(d) !== 0
        : (wasm_exports.wasm_get_dir_val ? wasm_exports.wasm_get_dir_val(d) > -1e15 : false);
      dir_values[d] = (valid && wasm_exports.wasm_get_dir_val) ? wasm_exports.wasm_get_dir_val(d) : null;
    }

    last_directional_telemetry = {
      up: dir_values[0],
      right: dir_values[1],
      down: dir_values[2],
      left: dir_values[3],
      best_dir: best_dir,
      raw: dir_values,
      source: 'wasm-expectimax'
    };

    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    last_move_time_ms = t1 - t0;
    return best_dir;
  }

  // fallback to javascript expectimax search
  const search_depth = get_search_depth(board);
  last_search_depth = search_depth;

  let best_dir = -1;
  let best_val = -Infinity;
  const dir_values = [null, null, null, null];

  const search_dirs = [0, 3, 1, 2];
  for (let i = 0; i < 4; i++) {
    const dir = search_dirs[i];
    const result = move(board, dir);
    if (!result.moved) {
      dir_values[dir] = null;
      continue;
    }

    const is_violation = (typeof check_anchor_violation === 'function') && check_anchor_violation(board, result.board);
    const penalty = is_violation ? -ANCHOR_PENALTY : 0;

    const val = penalty + expectimax_chance(result.board, search_depth - 1, 1.0);
    dir_values[dir] = val;

    if (val > best_val) {
      best_val = val;
      best_dir = dir;
    }
  }

  last_directional_telemetry = {
    up: dir_values[0],
    right: dir_values[1],
    down: dir_values[2],
    left: dir_values[3],
    best_dir: best_dir,
    raw: dir_values,
    source: 'expectimax'
  };

  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  last_move_time_ms = t1 - t0;
  return best_dir;
}

function get_directional_values() {
  return last_directional_telemetry;
}

function get_last_search_stats() {
  return {
    depth: last_search_depth,
    time_ms: last_move_time_ms,
    nodes: nodes_evaluated,
    tt_hits: tt_hits_count,
    directional: last_directional_telemetry,
    source: last_directional_telemetry.source || 'expectimax'
  };
}

if (typeof window !== 'undefined') {
  window.ai_best_move = ai_best_move;
  window.get_directional_values = get_directional_values;
  window.get_last_search_stats = get_last_search_stats;
  window.init_wasm = init_wasm;
  window.AI = {
    best_move: ai_best_move,
    get_stats: get_last_search_stats,
    is_wasm_ready: () => wasm_ready,
    init_wasm
  };
}