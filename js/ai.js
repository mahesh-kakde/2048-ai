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
const tt_probs = new Float32Array(TT_SIZE);
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

const EMBEDDED_WASM_B64 = "AGFzbQEAAAABQAtgAAF/YAF/AXxgAX8Bf2ACf38Bf2AEf39/fwF/YAN/f3wBfGAAAXxgAn5/AX9gAn9/AXxgA39/fwF/YAJ/fwADFxYAAQACAwQFBgEHCAkCAQAAAAMDBQoCBAUBcAEBAQUDAQBhBgkBfwFBgIDAAAsH6AENBm1lbW9yeQIACXdhc21faW5pdAAAEndhc21fZ2V0X2JvYXJkX3B0cgACD3dhc21fc2VhcmNoX2J1ZgADEXdhc21fZXZhbHVhdGVfYnVmAAcLd2FzbV9zZWFyY2gACRN3YXNtX2V2YWx1YXRlX2JvYXJkAAoRd2FzbV9zZWFyY2hfcGFydHMACxF3YXNtX2lzX2Rpcl92YWxpZAAMEHdhc21fZ2V0X2Rpcl92YWwADQ53YXNtX2dldF9ub2RlcwAOEHdhc21fZ2V0X3R0X2hpdHMADxF3YXNtX2dldF9iZXN0X2RpcgAQCuxbFoIKBAh/AXwBfwN+I4CAgIAAQSBrIgAkgICAgAAgAEEQakEEciEBQQAhAgNAIAJBA3QiAyACQQx0QYCAgPgAcSACQQ9xIgRyIAJBCHRBgIA8cSIFciACQQR0QYAecSIGchCBgICAADkDkIDAgAACQAJAIAQNACAAQRBqIQRBACEHDAELIAAgBDYCEEEBIQcgASEECwJAIAZFDQAgBCAGQQh2NgIAIAdBAWohBwsCQCAFRQ0AIABBEGogB0ECdHIgBUEQdjYCACAHQQFqIQcLAkACQAJAIAJBDHYiBEUNACAAQRBqIAdBAnRqIAQ2AgAgAEIANwMIIABCADcDACAHQQFqIQcMAQsgAEIANwMIIABCADcDACAHDQBBACEERAAAAAAAAAAAIQgMAQtEAAAAAAAAAAAhCEEAIQQgACEFA0AgAEEQaiAEQQJ0aigCACEGAkACQCAEQQFqIgkgB04NACAGIABBEGogCUECdGooAgBHDQAgBSAGQf4BIAZB/gFIG0EBaiIJNgIAIAhCASAJrYa6oCAIIAZBNEgbIQggBEECaiEEDAELIAUgBjYCACAJIQQLIAVBBGohBSAEIAdIDQALIAAoAgRBCHQgACgCAHIgACgCCEEQdHIgACgCDEEYdHIhBAsgAyAIOQOQgPCAACACQQJ0IAQ2ApCA4IAAIAJBAWoiAkGAgARHDQALQQAhBEGQgJCBACEFQZCAoIEAIQYDQCAGIARBBHRBgB5xIARBDHRyIARBBHZB8AFxciAEQYDgA3FBDHZyQf//A3EiCUEDdCsDkIDwgAA5AwAgBSAJQQJ0KAKQgOCAACIJQf+B/AdxQQh4IAlBGHhB/4H8B3FyNgIAIAZBCGohBiAFQQRqIQUgBEEBaiIEQYCABEcNAAtCm9W/pOe8kp6FfyEKQQAhCUGQgMCBACEGA0BBACEEA0AgBiAEaiIFQQhqIAoiC0Kq8NP0r+68tzx8IgpCHoggCoVCucuT59Htkay/f34iDEIbiCAMhULro8SZsbeS6JR/fiIMQh+IIAyFNwMAIAUgC0KV+Kn6l7fem55/fCILQh6IIAuFQrnLk+fR7ZGsv39+IgtCG4ggC4VC66PEmbG3kuiUf34iC0IfiCALhTcDACAEQRBqIgRBgAJHDQALIAZBgAJqIQYgCUEBaiIJQRBHDQALQYCAwH4hBANAIARB7KCAgwBqQQA7AQAgBEHooICDAGpBADYCACAEQeCggIMAakIANwMAIARB2KCAgwBqQgA3AwAgBEHUoICDAGpBADsBACAEQdCggIMAakEANgIAIARByKCAgwBqQgA3AwAgBEHAoICDAGpCADcDACAEQbyggIMAakEAOwEAIARBuKCAgwBqQQA2AgAgBEGwoICDAGpCADcDACAEQaiggIMAakIANwMAIARBpKCAgwBqQQA7AQAgBEGgoICDAGpBADYCACAEQZiggIMAakIANwMAIARBkKCAgwBqQgA3AwAgBEHgAGoiBA0AC0EAQuqZgs2Ty8+URjcDsKCAgwBBAEIANwOgoICDAEEAQuqZgs2Ty8+URjcDuKCAgwBBAELqmYLNk8vPlEY3A8CggIMAQQBCADcDqKCAgwBBAELqmYLNk8vPlEY3A8iggIMAQQBBAToA0KCAgwBBAEEANgKUoICDAEEAQQA6AJCggIMAQQBBADYCmKCAgwAgAEEgaiSAgICAAEEBC8gDAwJ8AX8DfEQAAAAAAAAAACEBRAAAAAAAAAAAIQICQCAAQf8BcSIDRQ0AIAO4IQQCQCADQTJJDQAgBEQAAAAAAAAQQ6IhAgwBCyAEQgEgA62GuqIhAgsCQCAAQQh2Qf8BcSIDRQ0AIAO4IQECQCADQTJJDQAgAUQAAAAAAAAQQ6IhAQwBCyABQgEgA62GuqIhAQtEAAAAAAAAAAAhBUQAAAAAAAAAACEEAkAgAEEQdkH/AXEiA0UNACADuCEEAkAgA0EySQ0AIAREAAAAAAAAEEOiIQQMAQsgBEIBIAOthrqiIQQLAkAgAEEYdiIDRQ0AIAO4IQUCQCAAQYCAgJADSQ0AIAVEAAAAAAAAEEOiIQUMAQsgBUIBIAOthrqiIQULIAQgASACIAIgAiABoCACIAGhRAAAAAAAAChAoiACIAFmG6AiBqAgBiACIAFhGyAGIAJEAAAAAAAAAABkGyABIASgIAEgBKFEAAAAAAAAKECiIAEgBGYboCICoCACIAEgBGEbIAIgAUQAAAAAAAAAAGQbIAQgBaAgBCAFoUQAAAAAAAAoQKIgBCAFZhugIgGgIAEgBCAFYRsgASAERAAAAAAAAAAAZBsLCABB4KCAgwALXgIBfwJ+I4CAgIAAQSBrIgEkgICAgAAgAUEAKQPgoICDACICNwMQIAFBACkD6KCAgwAiAzcDGCABIAI3AwAgASADNwMIIAEgABCEgICAACEAIAFBIGokgICAgAAgAAu3CAICfwN8I4CAgIAAQaABayICJICAgIAAAkBBAC0A0KCAgwANABCAgICAABoLQQBBfzYCgIDAgABBAEEALQCQoICDAEEBajoAkKCAgwBBAEEANgKYoICDAEEAQQA2ApSggIMAIAAtAAAhAyACIAApAwg3A4ABIAIgACkDADcDeCABQX9qIQECQAJAIAJB+ABqQQAgAkGQAWogAkGIAWoQhYCAgAANAEEAQuqZgs2Ty8+URjcDsKCAgwBBAEEANgKgoICDAETqjKA5WT4pxiEEDAELAkACQCADQQZJDQBEAAAAIF+gAsIhBCACLQCQASADSQ0BC0QAAAAAAAAAACEECyACIAIpA5gBNwNwIAIgAikDkAE3A2ggAkHoAGogAUQAAAAAAADwPxCGgICAACEFQQBBATYCoKCAgwBBACAEIAWgIgU5A7CggIMAROqMoDlZPinGIQQgBUTqjKA5WT4pxmRFDQBBAEEANgKAgMCAACAFIQQLIAIgACkDADcDWCACIAApAwg3A2ACQAJAIAJB2ABqQQMgAkGQAWogAkGIAWoQhYCAgABFDQACQAJAIANBBkkNAEQAAAAgX6ACwiEFIAItAJABIANJDQELRAAAAAAAAAAAIQULIAIgAikDmAE3A1AgAiACKQOQATcDSCACQcgAaiABRAAAAAAAAPA/EIaAgIAAIQZBAEEBNgKsoICDAEEAIAUgBqAiBTkDyKCAgwAgBSAEZEUNAUEAQQM2AoCAwIAAIAUhBAwBC0EAQuqZgs2Ty8+URjcDyKCAgwBBAEEANgKsoICDAAsgAiAAKQMANwM4IAIgACkDCDcDQAJAAkAgAkE4akEBIAJBkAFqIAJBiAFqEIWAgIAARQ0AAkACQCADQQZJDQBEAAAAIF+gAsIhBSACLQCQASADSQ0BC0QAAAAAAAAAACEFCyACIAIpA5gBNwMwIAIgAikDkAE3AyggAkEoaiABRAAAAAAAAPA/EIaAgIAAIQZBAEEBNgKkoICDAEEAIAUgBqAiBTkDuKCAgwAgBSAEZEUNAUEAQQE2AoCAwIAAIAUhBAwBC0EAQuqZgs2Ty8+URjcDuKCAgwBBAEEANgKkoICDAAsgAiAAKQMANwMYIAIgACkDCDcDIAJAAkAgAkEYakECIAJBkAFqIAJBiAFqEIWAgIAARQ0AAkACQCADQQZJDQBEAAAAIF+gAsIhBSACLQCQASADSQ0BC0QAAAAAAAAAACEFCyACIAIpA5gBNwMQIAIgAikDkAE3AwggAkEIaiABRAAAAAAAAPA/EIaAgIAAIQZBAEEBNgKooICDAEEAIAUgBqAiBTkDwKCAgwAgBSAEZEUNAUEAQQI2AoCAwIAADAELQQBC6pmCzZPLz5RGNwPAoICDAEEAQQA2AqiggIMAC0EAKAKAgMCAACEAIAJBoAFqJICAgIAAIAALiQsDAn8HfgN/I4CAgIAAQSBrIgQkgICAgABBACEFAkACQAJAAkACQAJAIAEOBAIBAwAFCyAAKQMIIQYgACkDACIHpyAEQRhqEJGAgIAAIQUgB0IgiKcgBEEQahCRgICAACEAIAanIARBCGoQkYCAgAAhASAGQiCIpyAEEJGAgIAArUIghiABrYQhCAJAIAcgAK1CIIYgBa2EIglSDQBBACEFIAggBlENBQsgAiAINwMIIAIgCTcDACADIAQrAxggBCsDEKAgBCsDCKAgBCsDAKA5AwAMAwsgACkDCCEGIAApAwAiB6cgBEEYahCSgICAACEFIAdCIIinIARBEGoQkoCAgAAhACAGpyAEQQhqEJKAgIAAIQEgBkIgiKcgBBCSgICAAK1CIIYgAa2EIQgCQCAHIACtQiCGIAWthCIJUg0AQQAhBSAIIAZRDQQLIAIgCDcDCCACIAk3AwAgAyAEKwMYIAQrAxCgIAQrAwigIAQrAwCgOQMADAILIAApAwAiBkIYiEKA/gODIAZC/wGDhCAAKQMIIgdCEIZCgID8B4OEIAdCCIhCgICA+A+DhCIKpyAEQRhqEJGAgIAAIQAgBkIIiEL/AYMgBkIgiEKA/gODhCAHQgiGQoCA/AeDhCAHQhCIQoCAgPgPg4QiC6cgBEEQahCRgICAACEBIAZCEIhC/wGDIAZCKIhCgP4Dg4QgB0KAgPwHg4QgB0IYiEKAgID4D4OEIgynIARBCGoQkYCAgAAhDSAGQjCIp0GA/gNxIAanQRh2ciAHp0EIdkGAgPwHcXIgB0IgiKdBgICAeHFyIg4gBBCRgICAACIPrSEGIA2tIQcCQCABrSIIQiCGIACtIgmEIAogC0IghoRSDQAgBkIghiAHhCAOrUIghiAMhFENAwsgAyAEKwMYIAQrAxCgIAQrAwigIAQrAwCgOQMAIAIgCEIIiEKA/gODIAlCEIhC/wGDhCAHQoCA/AeDhCAGQgiGQoCAgPgPg4QgAUEQdkGA/gNxIABBGHZyIA1BCHZBgID8B3FyIA9BgICAeHFyrUIghoQ3AwggAiAIQgiGQoD+A4MgCUL/AYOEIAdCEIZCgID8B4OEIAZCGIZCgICA+A+DhCAJQgiIQv8BgyAIQoD+A4OEIAdCCIZCgID8B4OEIAZCEIZCgICA+A+DhEIghoQ3AwAMAQsgACkDACIGQhiIQoD+A4MgBkL/AYOEIAApAwgiB0IQhkKAgPwHg4QgB0IIiEKAgID4D4OEIgqnIARBGGoQkoCAgAAhACAGQgiIQv8BgyAGQiCIQoD+A4OEIAdCCIZCgID8B4OEIAdCEIhCgICA+A+DhCILpyAEQRBqEJKAgIAAIQEgBkIQiEL/AYMgBkIoiEKA/gODhCAHQoCA/AeDhCAHQhiIQoCAgPgPg4QiDKcgBEEIahCSgICAACENIAZCMIinQYD+A3EgBqdBGHZyIAenQQh2QYCA/AdxciAHQiCIp0GAgIB4cXIiDiAEEJKAgIAAIg+tIQYgDa0hBwJAIAGtIghCIIYgAK0iCYQgCiALQiCGhFINACAGQiCGIAeEIA6tQiCGIAyEUQ0CCyADIAQrAxggBCsDEKAgBCsDCKAgBCsDAKA5AwAgAiAIQgiIQoD+A4MgCUIQiEL/AYOEIAdCgID8B4OEIAZCCIZCgICA+A+DhCABQRB2QYD+A3EgAEEYdnIgDUEIdkGAgPwHcXIgD0GAgIB4cXKtQiCGhDcDCCACIAhCCIZCgP4DgyAJQv8Bg4QgB0IQhkKAgPwHg4QgBkIYhkKAgID4D4OEIAlCCIhC/wGDIAhCgP4Dg4QgB0IIhkKAgPwHg4QgBkIQhkKAgID4D4OEQiCGhDcDAAtBASEFCyAEQSBqJICAgIAAIAUL4wkHAX8BfgJ/AX4DfAJ/An4jgICAgABBkAFrIgMkgICAgAACQAJAIAApAwAiBEL/AYNCAFENAEEAIQUgA0HQAGohBgwBCyADQQA2AlAgA0HQAGpBBHIhBkEBIQULAkAgBEKA/gODQgBSDQAgBkEBNgIAIAVBAWohBQsCQCAEQoCA/AeDQgBSDQAgA0HQAGogBUECdHJBAjYCACAFQQFqIQULAkAgBEKAgID4D4NCAFINACADQdAAaiAFQQJ0akEDNgIAIAVBAWohBQsCQCAEQoCAgIDwH4NCAFINACADQdAAaiAFQQJ0akEENgIAIAVBAWohBQsCQCAEQoCAgICA4D+DQgBSDQAgA0HQAGogBUECdGpBBTYCACAFQQFqIQULAkAgBEKAgICAgIDA/wCDQgBSDQAgA0HQAGogBUECdGpBBjYCACAFQQFqIQULIAApAwghBwJAIARC//////////8AVg0AIANB0ABqIAVBAnRqQQc2AgAgBUEBaiEFCwJAIAdC/wGDQgBSDQAgA0HQAGogBUECdGpBCDYCACAFQQFqIQULAkAgB0KA/gODQgBSDQAgA0HQAGogBUECdGpBCTYCACAFQQFqIQULAkAgB0KAgPwHg0IAUg0AIANB0ABqIAVBAnRqQQo2AgAgBUEBaiEFCwJAIAdCgICA+A+DQgBSDQAgA0HQAGogBUECdGpBCzYCACAFQQFqIQULAkAgB0KAgICA8B+DQgBSDQAgA0HQAGogBUECdGpBDDYCACAFQQFqIQULAkAgB0KAgICAgOA/g0IAUg0AIANB0ABqIAVBAnRqQQ02AgAgBUEBaiEFCwJAIAdCgICAgICAwP8Ag0IAUg0AIANB0ABqIAVBAnRqQQ42AgAgBUEBaiEFCwJAAkACQCAHQv//////////AFYNACADQdAAaiAFQQJ0akEPNgIAIAVBAWohBQwBCyAFDQBBAEEAKAKUoICDAEEBajYClKCAgwAgAyAAKQMANwMwIAMgACkDCDcDOCADQTBqEIiAgIAAIQIMAQsgAiAFuKMiAkSamZmZmZm5P6IhCCACRM3MzMzMzOw/oiEJRAAAAAAAAAAAIQogA0HQAGohBkQAAAAAAAAAACECA0AgBigCACELAkAgCUQtQxzr4jYaP2ZFDQAgC0EDdCEMAkACQCALQQdKDQBCASAMrYYgBIQhDSAHIQ4MAQtCASAMQUBqrYYgB4QhDiAEIQ0LIAMgDjcDSCADIA03A0AgAyANNwMgIAMgDjcDKCACRM3MzMzMzOw/oCECIANBIGogASAJEJOAgIAARM3MzMzMzOw/oiAKoCEKCwJAIAhELUMc6+I2Gj9mRQ0AIAtBA3QhDAJAAkAgC0EHSg0AQgIgDK2GIASEIQ0gByEODAELQgIgDEFAaq2GIAeEIQ4gBCENCyADIA43A0ggAyANNwNAIAMgDTcDECADIA43AxggAkSamZmZmZm5P6AhAiADQRBqIAEgCBCTgICAAESamZmZmZm5P6IgCqAhCgsgBkEEaiEGIAVBf2oiBQ0ACwJAIAJEAAAAAAAAAABkRQ0AIAogAqMhAgwBC0EAQQAoApSggIMAQQFqNgKUoICDACADIAApAwA3AwAgAyAAKQMINwMIIAMQiICAgAAhAgsgA0GQAWokgICAgAAgAgtzAwF/An4BfCOAgICAAEEgayIAJICAgIAAAkBBAC0A0KCAgwANABCAgICAABoLIABBACkD4KCAgwAiATcDECAAQQApA+iggIMAIgI3AxggACABNwMAIAAgAjcDCCAAEIiAgIAAIQMgAEEgaiSAgICAACADC+8HCwt+AX8BfAF/AXwCfwF8An8BfAF/BHwgACkDCCIBQiCIIQIgACkDACIDQiiIIQQgA0IQiCEFIANCIIgiBkKA/gODIQcgA0IIiEL/AYMhCCABQgiGIQkgA0IYiEKA/gODIANC/wGDhCEKIAFCEIZCgID8B4MhCyAGpyEAAkACQCADpyIMQfDhw4d/cQ0AIAxBBHZB8AFxIAxBD3FyQQN0IAxBBXZBgPABcXIgDEEJdkGAgB5xcisDkIDAgAAhDQwBCyAMEIGAgIAAIQ0LIAGnIQ4gA0IwiCEDIARCgP4DgyEEIAVC/wGDIQUgCCAHhCEGIAlCgID8B4MhByABQhCIIQggCiALhCEJIAJCGIYhCgJAAkAgAEHw4cOHf3ENACAAQQR2QfABcSAAQQ9xckEDdCAAQQV2QYDwAXFyIABBCXZBgIAecXIrA5CAwIAAIQ8MAQsgABCBgICAACEPCyAOQQh2IRAgA6chESACpyEAIAUgBIQhAyABQoCA/AeDIQIgAUIYiCEBIAYgB4QhBCAIQoCAgPgPgyEFIAkgCoQhBgJAAkAgDkHw4cOHf3ENACAOQQR2QfABcSAOQQ9xciAQQYAecXJBA3QgDkEJdkGAgB5xcisDkIDAgAAhEgwBCyAOEIGAgIAAIRILIBBBgID8B3EhEyARQYD+A3EhFCADIAKEIQMgAUKAgID4D4MhASAEIAWEIQIgBqchEAJAAkAgAEHw4cOHf3ENACAAQQR2QfABcSAAQQ9xckEDdCAAQQV2QYDwAXFyIABBCXZBgIAecXIrA5CAwIAAIRUMAQsgABCBgICAACEVCyAUIBNyIRQgAEGAgIB4cSEWIAMgAYQhAyACpyETAkACQCAQQfDhw4d/cQ0AIBBBBHZB8AFxIBBBD3FyQQN0IBBBBXZBgPABcXIgEEEJdkGAgB5xcisDkIDAgAAhFwwBCyAQEIGAgIAAIRcLIBQgFnIhECAMQRh2IRQgA6chDAJAAkAgE0Hw4cOHf3ENACATQQR2QfABcSATQQ9xckEDdCATQQV2QYDwAXFyIBNBCXZBgIAecXIrA5CAwIAAIRgMAQsgExCBgICAACEYCyAQIBRyIRACQAJAIAxB8OHDh39xDQAgDEEEdkHwAXEgDEEPcXJBA3QgDEEFdkGA8AFxciAMQQl2QYCAHnFyKwOQgMCAACEZDAELIAwQgYCAgAAhGQsCQAJAIBBB8OHDh39xDQAgEUEEdkHwAXEgFEEPcXJBA3QgDkENdkGA8AFxciAAQQl2QYCAHnFyKwOQgMCAACEaDAELIBAQgYCAgAAhGgsgDSAPoCASoCAVoCAXoCAYoCAZoCAaoAuZAgIBfwF+I4CAgIAAQSBrIgIkgICAgAAgAiAAQiCIQg+DIABCHIhCgB6DhCAAQhiIQoCAPIOEIABCFIhCgICA+ACDhCAAQhCIQoCAgIDwAYOEIABCDIhCgICAgIDgA4OEIABCCIhCgICAgICAwAeDhCAAQgSIQoCAgICAgICAD4OEIgM3AxggAiAAQgSGQoAegyAAQg+DhCAAQgiGQoCAPIOEIABCDIZCgICA+ACDhCAAQhCGQoCAgIDwAYOEIABCFIZCgICAgIDgA4OEIABCGIZCgICAgICAwAeDhCAAQhyGQoCAgICAgICAD4OEIgA3AxAgAiAANwMAIAIgAzcDCCACIAEQhICAgAAhASACQSBqJICAgIAAIAELsQIDAX8CfgF8I4CAgIAAQSBrIgIkgICAgAACQEEALQDQoICDAA0AEICAgIAAGgsgAiABrSIDQgSGQoAegyADQg+DhCADQgiGQoCAPIOEIANCDIZCgICA+ACDhCADQhCGQoCAgIDwAYOEIANCFIZCgICAgIDgA4OEIANCGIZCgICAgICAwAeDhCADQhyGQoCAgICAgICAD4OEIgQ3AxggAiAArSIDQgSGQoAegyADQg+DhCADQgiGQoCAPIOEIANCDIZCgICA+ACDhCADQhCGQoCAgIDwAYOEIANCFIZCgICAgIDgA4OEIANCGIZCgICAgICAwAeDhCADQhyGQoCAgICAgICAD4OEIgM3AxAgAiADNwMAIAIgBDcDCCACEIiAgIAAIQUgAkEgaiSAgICAACAFC5wCAgF/An4jgICAgABBIGsiAySAgICAACADIAGtIgRCBIZCgB6DIARCD4OEIARCCIZCgIA8g4QgBEIMhkKAgID4AIOEIARCEIZCgICAgPABg4QgBEIUhkKAgICAgOADg4QgBEIYhkKAgICAgIDAB4OEIARCHIZCgICAgICAgIAPg4QiBTcDGCADIACtIgRCBIZCgB6DIARCD4OEIARCCIZCgIA8g4QgBEIMhkKAgID4AIOEIARCEIZCgICAgPABg4QgBEIUhkKAgICAgOADg4QgBEIYhkKAgICAgIDAB4OEIARCHIZCgICAgICAgIAPg4QiBDcDECADIAQ3AwAgAyAFNwMIIAMgAhCEgICAACEBIANBIGokgICAgAAgAQsiAQF/QQAhAQJAIABBA0sNACAAQQJ0KAKgoICDACEBCyABCykBAXxE6oygOVk+KcYhAQJAIABBA0sNACAAQQN0KwOwoICDACEBCyABCwsAQQAoApSggIMACwsAQQAoApiggIMACwsAQQAoAoCAwIAAC4QEAwR/AXwBfyOAgICAAEEgayECAkAgAEHw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";

const WASM_BINARY_PATH = 'wasm/engine.2d828974.wasm';

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

  if (tt_keys[tt_idx] === hash && tt_depths[tt_idx] >= depth && tt_probs[tt_idx] >= prob * (1.0 - 1e-6)) {
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
    if (depth > tt_depths[tt_idx] || (depth === tt_depths[tt_idx] && prob > tt_probs[tt_idx])) {
      tt_depths[tt_idx] = depth;
      tt_values[tt_idx] = final_val;
      tt_probs[tt_idx] = prob;
      tt_age[tt_idx] = current_search_age;
    }
  } else if (tt_age[tt_idx] !== current_search_age || depth >= tt_depths[tt_idx]) {
    tt_keys[tt_idx] = hash;
    tt_depths[tt_idx] = depth;
    tt_values[tt_idx] = final_val;
    tt_probs[tt_idx] = prob;
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