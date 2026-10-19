// webassembly expectimax search engine for 2048
// bitboard representation: 64-bit integer (16 nibbles, 4 bits per cell)
// zero-allocation expectimax search with zobrist hashing and transposition caching

typedef unsigned char uint8_t;
typedef char int8_t;
typedef unsigned short uint16_t;
typedef unsigned int uint32_t;
typedef unsigned long long uint64_t;

#ifdef __wasm__
#define WASM_EXPORT(name) __attribute__((export_name(#name)))
#else
#define WASM_EXPORT(name) __declspec(dllexport)
#endif

#define ANCHOR_PENALTY 10000000.0f
#define PROB_THRESHOLD 0.0001f
#define TT_SIZE 131072
#define TT_MASK (TT_SIZE - 1)

typedef struct {
    uint64_t key;
    float value;
    int8_t depth;
    uint8_t age;
} tt_entry_t;

// row slide tables (65,536 entries each)
static uint16_t row_left_table[65536];
static float row_score_table[65536];
static uint16_t row_right_table[65536];
static float row_right_score_table[65536];

// monotonic score map tables (65,536 entries each)
static float score_map_desc[65536];
static float score_map_asc[65536];
static const float *current_row_score_table = score_map_desc;
static const float *current_col_score_table = score_map_desc;

// zobrist hashing table (16 positions x 16 exponents)
static uint64_t zobrist_table[16][16];

// transposition table
static tt_entry_t transposition_table[TT_SIZE];
static uint8_t current_search_age = 0;
static uint32_t nodes_evaluated = 0;
static uint32_t tt_hits_count = 0;

// search telemetry
static float last_dir_values[4];
static int last_best_dir = -1;

// optional n-tuple network weights (4 base tuples x 16^5 entries = 4,194,304 floats)
static float *tuple_weights = 0;
static int use_tuple = 0;

// expanded 32 tuples (4 base patterns x 8 d4 symmetries)
// format: {base_id, c0, c1, c2, c3, c4}
static const int expanded_tuples[32][6] = {
    // base 0: [0, 1, 2, 3, 4]
    {0, 0, 1, 2, 3, 4},
    {0, 3, 7, 11, 15, 2},
    {0, 15, 14, 13, 12, 11},
    {0, 12, 8, 4, 0, 13},
    {0, 3, 2, 1, 0, 7},
    {0, 12, 13, 14, 15, 8},
    {0, 0, 4, 8, 12, 1},
    {0, 15, 11, 7, 3, 14},

    // base 1: [0, 1, 4, 5, 2]
    {1, 0, 1, 4, 5, 2},
    {1, 3, 7, 2, 6, 11},
    {1, 15, 14, 11, 10, 13},
    {1, 12, 8, 13, 9, 4},
    {1, 3, 2, 7, 6, 1},
    {1, 12, 13, 8, 9, 14},
    {1, 0, 4, 1, 5, 8},
    {1, 15, 11, 14, 10, 7},

    // base 2: [0, 1, 4, 5, 8]
    {2, 0, 1, 4, 5, 8},
    {2, 3, 7, 2, 6, 1},
    {2, 15, 14, 11, 10, 7},
    {2, 12, 8, 13, 9, 14},
    {2, 3, 2, 7, 6, 11},
    {2, 12, 13, 8, 9, 4},
    {2, 0, 4, 1, 5, 2},
    {2, 15, 11, 14, 10, 13},

    // base 3: [0, 1, 2, 4, 8]
    {3, 0, 1, 2, 4, 8},
    {3, 3, 7, 11, 2, 1},
    {3, 15, 14, 13, 11, 7},
    {3, 12, 8, 4, 13, 14},
    {3, 3, 2, 1, 7, 11},
    {3, 12, 13, 14, 8, 4},
    {3, 0, 4, 8, 1, 2},
    {3, 15, 11, 7, 14, 13}
};

// splitmix64 deterministic prng
static uint64_t prng_seed = 0x853c49e6748fea9bULL;
static inline uint64_t splitmix64(void) {
    prng_seed += 0x9e3779b97f4a7c15ULL;
    uint64_t z = prng_seed;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

static inline uint16_t reverse_row(uint16_t r) {
    return (uint16_t)(((r & 0x000F) << 12) |
                     ((r & 0x00F0) << 4) |
                     ((r & 0x0F00) >> 4) |
                     ((r & 0xF000) >> 12));
}

// bitboard transpose
static inline uint64_t transpose(uint64_t x) {
    return ((x & 0x000000000000000FULL)) |
           ((x & 0x00000000000000F0ULL) << 12) |
           ((x & 0x0000000000000F00ULL) << 24) |
           ((x & 0x000000000000F000ULL) << 36) |
           ((x & 0x00000000000F0000ULL) >> 12) |
           ((x & 0x0000000000F00000ULL)) |
           ((x & 0x000000000F000000ULL) << 12) |
           ((x & 0x00000000F0000000ULL) << 24) |
           ((x & 0x0000000F00000000ULL) >> 24) |
           ((x & 0x000000F000000000ULL) >> 12) |
           ((x & 0x00000F0000000000ULL)) |
           ((x & 0x0000F00000000000ULL) << 12) |
           ((x & 0x000F000000000000ULL) >> 36) |
           ((x & 0x00F0000000000000ULL) >> 24) |
           ((x & 0x0F00000000000000ULL) >> 12) |
           ((x & 0xF000000000000000ULL));
}

// left move on bitboard
static inline int move_left(uint64_t b, uint64_t *out_b, float *out_score) {
    uint16_t r0 = (uint16_t)(b & 0xFFFF);
    uint16_t r1 = (uint16_t)((b >> 16) & 0xFFFF);
    uint16_t r2 = (uint16_t)((b >> 32) & 0xFFFF);
    uint16_t r3 = (uint16_t)((b >> 48) & 0xFFFF);

    uint16_t nr0 = row_left_table[r0];
    uint16_t nr1 = row_left_table[r1];
    uint16_t nr2 = row_left_table[r2];
    uint16_t nr3 = row_left_table[r3];

    uint64_t res = (uint64_t)nr0 | ((uint64_t)nr1 << 16) | ((uint64_t)nr2 << 32) | ((uint64_t)nr3 << 48);
    if (res == b) return 0;

    *out_b = res;
    *out_score = row_score_table[r0] + row_score_table[r1] + row_score_table[r2] + row_score_table[r3];
    return 1;
}

// right move on bitboard
static inline int move_right(uint64_t b, uint64_t *out_b, float *out_score) {
    uint16_t r0 = (uint16_t)(b & 0xFFFF);
    uint16_t r1 = (uint16_t)((b >> 16) & 0xFFFF);
    uint16_t r2 = (uint16_t)((b >> 32) & 0xFFFF);
    uint16_t r3 = (uint16_t)((b >> 48) & 0xFFFF);

    uint16_t nr0 = row_right_table[r0];
    uint16_t nr1 = row_right_table[r1];
    uint16_t nr2 = row_right_table[r2];
    uint16_t nr3 = row_right_table[r3];

    uint64_t res = (uint64_t)nr0 | ((uint64_t)nr1 << 16) | ((uint64_t)nr2 << 32) | ((uint64_t)nr3 << 48);
    if (res == b) return 0;

    *out_b = res;
    *out_score = row_right_score_table[r0] + row_right_score_table[r1] + row_right_score_table[r2] + row_right_score_table[r3];
    return 1;
}

// execute move: 0=up, 1=right, 2=down, 3=left
static inline int execute_move(uint64_t b, int dir, uint64_t *out_b, float *out_score) {
    if (dir == 3) {
        return move_left(b, out_b, out_score);
    } else if (dir == 1) {
        return move_right(b, out_b, out_score);
    } else if (dir == 0) {
        uint64_t tb = transpose(b);
        uint64_t ntb;
        if (!move_left(tb, &ntb, out_score)) return 0;
        *out_b = transpose(ntb);
        return 1;
    } else if (dir == 2) {
        uint64_t tb = transpose(b);
        uint64_t ntb;
        if (!move_right(tb, &ntb, out_score)) return 0;
        *out_b = transpose(ntb);
        return 1;
    }
    return 0;
}

static inline uint64_t compute_zobrist_hash_bb(uint64_t bb) {
    uint64_t h = 0;
    uint64_t temp = bb;
    for (int i = 0; i < 16; i++) {
        int exp = (int)(temp & 0xF);
        h ^= zobrist_table[i][exp];
        temp >>= 4;
    }
    return h;
}

static inline int get_empty_cells_bb(uint64_t b, int *empty_indices) {
    int count = 0;
    uint64_t temp = b;
    for (int i = 0; i < 16; i++) {
        if ((temp & 0xF) == 0) {
            empty_indices[count++] = i;
        }
        temp >>= 4;
    }
    return count;
}

static inline uint64_t spawn_tile(uint64_t b, int idx, int t_exp) {
    return b | ((uint64_t)t_exp << (idx * 4));
}

// checks if move displaces or disrupts corner anchor
static inline int check_anchor_violation_bb(uint64_t old_b, uint64_t new_b) {
    int max_exp = 0;
    uint64_t temp = old_b;
    for (int i = 0; i < 16; i++) {
        int exp = (int)(temp & 0xF);
        if (exp > max_exp) max_exp = exp;
        temp >>= 4;
    }

    if (max_exp < 7) return 0; // anchor threshold: 128 (exponent 7)

    static const int corner_indices[4] = {0, 3, 12, 15};
    int corner_anchor = -1;
    for (int i = 0; i < 4; i++) {
        int c_idx = corner_indices[i];
        if (((old_b >> (c_idx * 4)) & 0xF) == max_exp) {
            corner_anchor = c_idx;
            break;
        }
    }

    if (corner_anchor < 0) return 0;

    // primary invariant: corner tile must never decrease
    int new_corner_val = (int)((new_b >> (corner_anchor * 4)) & 0xF);
    if (new_corner_val < max_exp) {
        return 1;
    }

    // secondary invariant: protect adjacent perimeter edges from being emptied
    if (max_exp >= 9) { // >= 512
        int adj_c = -1;
        int adj_r = -1;
        if (corner_anchor == 0) {
            adj_c = 1; adj_r = 4;
        } else if (corner_anchor == 3) {
            adj_c = 2; adj_r = 7;
        } else if (corner_anchor == 12) {
            adj_c = 13; adj_r = 8;
        } else {
            adj_c = 14; adj_r = 11;
        }

        int adj_c_exp = (int)((old_b >> (adj_c * 4)) & 0xF);
        int adj_r_exp = (int)((old_b >> (adj_r * 4)) & 0xF);

        if (adj_c_exp >= max_exp - 2 && (((new_b >> (adj_c * 4)) & 0xF) == 0)) {
            return 1;
        }
        if (adj_r_exp >= max_exp - 2 && (((new_b >> (adj_r * 4)) & 0xF) == 0)) {
            return 1;
        }
    }

    return 0;
}

static void set_search_orientation(uint64_t b) {
    int max_exp = 0;
    uint64_t temp = b;
    for (int i = 0; i < 16; i++) {
        int exp = (int)(temp & 0xF);
        if (exp > max_exp) max_exp = exp;
        temp >>= 4;
    }

    int c_tl = (int)(b & 0xF);                // [0][0]
    int c_tr = (int)((b >> 12) & 0xF);        // [0][3]
    int c_bl = (int)((b >> 48) & 0xF);        // [3][0]
    int c_br = (int)((b >> 60) & 0xF);        // [3][3]

    if (max_exp >= 7) { // 128 or higher: anchor established
        if (c_tl == max_exp) {
            current_row_score_table = score_map_desc;
            current_col_score_table = score_map_desc;
            return;
        } else if (c_tr == max_exp) {
            current_row_score_table = score_map_asc;
            current_col_score_table = score_map_desc;
            return;
        } else if (c_bl == max_exp) {
            current_row_score_table = score_map_desc;
            current_col_score_table = score_map_asc;
            return;
        } else if (c_br == max_exp) {
            current_row_score_table = score_map_asc;
            current_col_score_table = score_map_asc;
            return;
        }
    }

    // default: top-left corner
    current_row_score_table = score_map_desc;
    current_col_score_table = score_map_desc;
}

static inline float score_map_evaluate_bb(uint64_t b) {
    uint64_t tb = transpose(b);
    uint16_t r0 = (uint16_t)(b & 0xFFFF);
    uint16_t r1 = (uint16_t)((b >> 16) & 0xFFFF);
    uint16_t r2 = (uint16_t)((b >> 32) & 0xFFFF);
    uint16_t r3 = (uint16_t)((b >> 48) & 0xFFFF);

    uint16_t c0 = (uint16_t)(tb & 0xFFFF);
    uint16_t c1 = (uint16_t)((tb >> 16) & 0xFFFF);
    uint16_t c2 = (uint16_t)((tb >> 32) & 0xFFFF);
    uint16_t c3 = (uint16_t)((tb >> 48) & 0xFFFF);

    return current_row_score_table[r0] + current_row_score_table[r1] +
           current_row_score_table[r2] + current_row_score_table[r3] +
           current_col_score_table[c0] + current_col_score_table[c1] +
           current_col_score_table[c2] + current_col_score_table[c3];
}

static inline float evaluate_board_bb(uint64_t b) {
    if (use_tuple && tuple_weights) {
        int powers[16];
        uint64_t temp = b;
        for (int i = 0; i < 16; i++) {
            powers[i] = (int)(temp & 0xF);
            temp >>= 4;
        }
        float score = 0.0f;
        for (int i = 0; i < 32; i++) {
            int base_id = expanded_tuples[i][0];
            uint32_t idx = ((uint32_t)powers[expanded_tuples[i][1]] << 16) |
                           ((uint32_t)powers[expanded_tuples[i][2]] << 12) |
                           ((uint32_t)powers[expanded_tuples[i][3]] << 8)  |
                           ((uint32_t)powers[expanded_tuples[i][4]] << 4)  |
                           ((uint32_t)powers[expanded_tuples[i][5]]);
            score += tuple_weights[base_id * 1048576 + idx];
        }
        return score;
    }
    return score_map_evaluate_bb(b);
}

static inline int is_game_over_bb(uint64_t b) {
    uint64_t temp = b;
    for (int i = 0; i < 16; i++) {
        if ((temp & 0xF) == 0) return 0;
        temp >>= 4;
    }
    for (int r = 0; r < 4; r++) {
        uint16_t row = (uint16_t)((b >> (r * 16)) & 0xFFFF);
        int c0 = row & 0xF;
        int c1 = (row >> 4) & 0xF;
        int c2 = (row >> 8) & 0xF;
        int c3 = (row >> 12) & 0xF;
        if (c0 == c1 || c1 == c2 || c2 == c3) return 0;
    }
    uint64_t tb = transpose(b);
    for (int r = 0; r < 4; r++) {
        uint16_t row = (uint16_t)((tb >> (r * 16)) & 0xFFFF);
        int c0 = row & 0xF;
        int c1 = (row >> 4) & 0xF;
        int c2 = (row >> 8) & 0xF;
        int c3 = (row >> 12) & 0xF;
        if (c0 == c1 || c1 == c2 || c2 == c3) return 0;
    }
    return 1;
}

static int is_initialized = 0;

static float expectimax_chance(uint64_t b, int depth, float prob);

static float expectimax_max(uint64_t b, int depth, float prob) {
    if (depth <= 0 || is_game_over_bb(b)) {
        nodes_evaluated++;
        return evaluate_board_bb(b);
    }

    uint64_t hash = compute_zobrist_hash_bb(b);
    uint32_t tt_idx = (uint32_t)(hash & TT_MASK);
    tt_entry_t *entry = &transposition_table[tt_idx];

    if (entry->key == hash && entry->depth >= depth) {
        tt_hits_count++;
        return entry->value;
    }

    float best = -1e12f;
    int has_valid_move = 0;

    for (int dir = 0; dir < 4; dir++) {
        uint64_t next_b;
        float move_score = 0.0f;
        if (!execute_move(b, dir, &next_b, &move_score)) continue;

        has_valid_move = 1;
        float penalty = check_anchor_violation_bb(b, next_b) ? -ANCHOR_PENALTY : 0.0f;
        float val = penalty + expectimax_chance(next_b, depth - 1, prob);
        if (val > best) best = val;
    }

    float final_val = has_valid_move ? best : evaluate_board_bb(b);

    if (entry->key == hash) {
        if (depth >= entry->depth) {
            entry->depth = (int8_t)depth;
            entry->value = final_val;
            entry->age = current_search_age;
        }
    } else if (entry->age != current_search_age || depth >= entry->depth) {
        entry->key = hash;
        entry->depth = (int8_t)depth;
        entry->value = final_val;
        entry->age = current_search_age;
    }

    return final_val;
}

static float expectimax_chance(uint64_t b, int depth, float prob) {
    int empty_indices[16];
    int empty_count = get_empty_cells_bb(b, empty_indices);

    if (empty_count == 0) {
        nodes_evaluated++;
        return evaluate_board_bb(b);
    }

    float avg = 0.0f;
    float weight_sum = 0.0f;
    float cell_prob = prob / (float)empty_count;

    for (int i = 0; i < empty_count; i++) {
        int cell = empty_indices[i];

        float branch_prob_2 = cell_prob * 0.9f;
        if (branch_prob_2 >= PROB_THRESHOLD) {
            uint64_t b2 = spawn_tile(b, cell, 1);
            float child_val_2 = expectimax_max(b2, depth, branch_prob_2);
            avg += 0.9f * child_val_2;
            weight_sum += 0.9f;
        }

        float branch_prob_4 = cell_prob * 0.1f;
        if (branch_prob_4 >= PROB_THRESHOLD) {
            uint64_t b4 = spawn_tile(b, cell, 2);
            float child_val_4 = expectimax_max(b4, depth, branch_prob_4);
            avg += 0.1f * child_val_4;
            weight_sum += 0.1f;
        }
    }

    if (weight_sum > 0.0f) {
        return avg / weight_sum;
    } else {
        nodes_evaluated++;
        return evaluate_board_bb(b);
    }
}

static inline int rank_tile_score(int r) {
    return (r == 0) ? 0 : (r << r);
}

static void init_score_map_tables(void) {
    for (uint32_t i = 0; i < 65536; i++) {
        int c0 = i & 0xF;
        int c1 = (i >> 4) & 0xF;
        int c2 = (i >> 8) & 0xF;
        int c3 = (i >> 12) & 0xF;

        int a0 = rank_tile_score(c0);
        int a1 = rank_tile_score(c1);
        int a2 = rank_tile_score(c2);
        int a3 = rank_tile_score(c3);

        // descending (left to right)
        int score_desc = a0;
        score_desc += (a0 >= a1) ? (a0 + a1) : ((a0 - a1) * 12);
        if (a0 == a1 && a0 > 0) score_desc += a0;
        score_desc += (a1 >= a2) ? (a1 + a2) : ((a1 - a2) * 12);
        if (a1 == a2 && a1 > 0) score_desc += a1;
        score_desc += (a2 >= a3) ? (a2 + a3) : ((a2 - a3) * 12);
        if (a2 == a3 && a2 > 0) score_desc += a2;
        score_map_desc[i] = (float)score_desc;

        // ascending (right to left)
        int score_asc = a3;
        score_asc += (a3 >= a2) ? (a3 + a2) : ((a3 - a2) * 12);
        if (a3 == a2 && a3 > 0) score_asc += a3;
        score_asc += (a2 >= a1) ? (a2 + a1) : ((a2 - a1) * 12);
        if (a2 == a1 && a2 > 0) score_asc += a2;
        score_asc += (a1 >= a0) ? (a1 + a0) : ((a1 - a0) * 12);
        if (a1 == a0 && a1 > 0) score_asc += a1;
        score_map_asc[i] = (float)score_asc;
    }
}

// exported webassembly interface functions

WASM_EXPORT(wasm_init)
int wasm_init(void) {
    init_score_map_tables();

    // initialize row tables
    for (uint32_t row = 0; row < 65536; row++) {
        int line[4];
        line[0] = row & 0xF;
        line[1] = (row >> 4) & 0xF;
        line[2] = (row >> 8) & 0xF;
        line[3] = (row >> 12) & 0xF;

        int tiles[4];
        int num_tiles = 0;
        for (int i = 0; i < 4; i++) {
            if (line[i] > 0) {
                tiles[num_tiles++] = line[i];
            }
        }

        int merged[4] = {0, 0, 0, 0};
        int m_idx = 0;
        float score = 0.0f;
        for (int i = 0; i < num_tiles; i++) {
            if (i + 1 < num_tiles && tiles[i] == tiles[i + 1]) {
                int new_exp = tiles[i] + 1;
                if (new_exp > 15) new_exp = 15;
                merged[m_idx++] = new_exp;
                score += (float)(1 << new_exp);
                i++;
            } else {
                merged[m_idx++] = tiles[i];
            }
        }

        uint16_t left_row = (uint16_t)(merged[0] | (merged[1] << 4) | (merged[2] << 8) | (merged[3] << 12));
        row_left_table[row] = left_row;
        row_score_table[row] = score;
    }

    for (uint32_t row = 0; row < 65536; row++) {
        uint16_t rev = reverse_row((uint16_t)row);
        uint16_t left_rev = row_left_table[rev];
        row_right_table[row] = reverse_row(left_rev);
        row_right_score_table[row] = row_score_table[rev];
    }

    // initialize zobrist hash table
    prng_seed = 0x853c49e6748fea9bULL;
    for (int pos = 0; pos < 16; pos++) {
        for (int exp = 0; exp < 16; exp++) {
            zobrist_table[pos][exp] = splitmix64();
        }
    }

    // reset transposition table
    for (int i = 0; i < TT_SIZE; i++) {
        transposition_table[i].key = 0;
        transposition_table[i].value = 0.0f;
        transposition_table[i].depth = 0;
        transposition_table[i].age = 0;
    }
    current_search_age = 0;
    nodes_evaluated = 0;
    tt_hits_count = 0;
    is_initialized = 1;

    return 1;
}

WASM_EXPORT(wasm_search)
int wasm_search(uint64_t board, int depth) {
    if (!is_initialized) {
        wasm_init();
    }

    set_search_orientation(board);

    nodes_evaluated = 0;
    tt_hits_count = 0;
    current_search_age = (uint8_t)((current_search_age + 1) & 0xFF);

    last_best_dir = -1;
    float best_val = -1e12f;

    for (int dir = 0; dir < 4; dir++) {
        uint64_t next_b;
        float move_score = 0.0f;
        if (!execute_move(board, dir, &next_b, &move_score)) {
            last_dir_values[dir] = -1e9f;
            continue;
        }

        float penalty = check_anchor_violation_bb(board, next_b) ? -ANCHOR_PENALTY : 0.0f;
        float val = penalty + expectimax_chance(next_b, depth - 1, 1.0f);
        last_dir_values[dir] = val;

        if (val > best_val) {
            best_val = val;
            last_best_dir = dir;
        }
    }

    return last_best_dir;
}

WASM_EXPORT(wasm_evaluate_board)
float wasm_evaluate_board(uint32_t board_low, uint32_t board_high) {
    if (!is_initialized) wasm_init();
    uint64_t b = ((uint64_t)board_high << 32) | (uint64_t)board_low;
    set_search_orientation(b);
    return evaluate_board_bb(b);
}

WASM_EXPORT(wasm_search_parts)
int wasm_search_parts(uint32_t board_low, uint32_t board_high, int depth) {
    uint64_t board = ((uint64_t)board_high << 32) | (uint64_t)board_low;
    return wasm_search(board, depth);
}

WASM_EXPORT(wasm_get_dir_val)
float wasm_get_dir_val(int dir) {
    if (dir < 0 || dir >= 4) return -1e9f;
    return last_dir_values[dir];
}

WASM_EXPORT(wasm_get_nodes)
int wasm_get_nodes(void) {
    return (int)nodes_evaluated;
}

WASM_EXPORT(wasm_get_tt_hits)
int wasm_get_tt_hits(void) {
    return (int)tt_hits_count;
}

WASM_EXPORT(wasm_get_best_dir)
int wasm_get_best_dir(void) {
    return last_best_dir;
}

WASM_EXPORT(wasm_init_tuple_weights)
int wasm_init_tuple_weights(void) {
#ifdef __wasm__
    int old_pages = __builtin_wasm_memory_grow(0, 256);
    if (old_pages < 0) return 0;
    tuple_weights = (float*)((uint32_t)old_pages * 65536);
    use_tuple = 1;
    return (int)((uint32_t)old_pages * 65536);
#else
    return 0;
#endif
}

WASM_EXPORT(wasm_set_use_tuple)
void wasm_set_use_tuple(int enable) {
    use_tuple = enable;
}