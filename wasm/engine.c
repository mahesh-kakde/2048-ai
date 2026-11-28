// webassembly expectimax search engine for 2048
// 128-bit board representation: two 64-bit integers (16 bytes, 8 bits per cell exponent)
// hybrid fast-path: o(1) 16-bit row lookup tables for tiles <= 32,768, seamless 8-bit fallback for 65,536+

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

#define ANCHOR_PENALTY 10000000000.0
#define PROB_THRESHOLD 0.0001
#define TT_SIZE 131072
#define TT_MASK (TT_SIZE - 1)
#define MAX_ZOBRIST_EXP 32

typedef struct {
    uint64_t lo;
    uint64_t hi;
} board_t;

typedef struct {
    uint64_t key;
    double value;
    float prob;
    int8_t depth;
    uint8_t age;
} tt_entry_t;

// row slide tables (65,536 entries each; output is 4-byte unpacked row supporting 32768+32768 -> 65536)
static uint32_t row_left_u32_table[65536];
static double row_score_table[65536];
static uint32_t row_right_u32_table[65536];
static double row_right_score_table[65536];

// monotonic score map table (65,536 entries for rows <= 32,768)
static double score_map_desc[65536];

// zobrist hashing table (16 positions x 32 exponents)
static uint64_t zobrist_table[16][MAX_ZOBRIST_EXP];

// transposition table
static tt_entry_t transposition_table[TT_SIZE];
static uint8_t current_search_age = 0;
static uint32_t nodes_evaluated = 0;
static uint32_t tt_hits_count = 0;

// shared 16-byte board buffer for zero-overhead js->wasm transfer
static uint8_t shared_board_buf[16];

// search telemetry
static double last_dir_values[4];
static int last_dir_valid[4];
static int last_best_dir = -1;

// splitmix64 deterministic prng
static uint64_t prng_seed = 0x853c49e6748fea9bULL;
static inline uint64_t splitmix64(void) {
    prng_seed += 0x9e3779b97f4a7c15ULL;
    uint64_t z = prng_seed;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

static inline uint16_t reverse_row16(uint16_t r) {
    return (uint16_t)(((r & 0x000F) << 12) |
                      ((r & 0x00F0) << 4) |
                      ((r & 0x0F00) >> 4) |
                      ((r & 0xF000) >> 12));
}

static inline uint32_t reverse_row_u32(uint32_t r) {
    return ((r & 0x000000FFU) << 24) |
           ((r & 0x0000FF00U) << 8)  |
           ((r & 0x00FF0000U) >> 8)  |
           ((r & 0xFF000000U) >> 24);
}

static inline uint32_t pack_row16(uint32_t row) {
    return (row & 0xFU) |
           ((row >> 4) & 0xF0U) |
           ((row >> 8) & 0xF00U) |
           ((row >> 12) & 0xF000U);
}

static inline uint32_t unpack_row16(uint16_t r) {
    return ((uint32_t)(r & 0xFU)) |
           (((uint32_t)(r & 0xF0U)) << 4) |
           (((uint32_t)(r & 0xF00U)) << 8) |
           (((uint32_t)(r & 0xF000U)) << 12);
}

static inline uint32_t compute_slide_left_u32(uint32_t row, double *out_score) {
    int tiles[4];
    int num_tiles = 0;
    for (int i = 0; i < 4; i++) {
        int e = (int)((row >> (i * 8)) & 0xFFU);
        if (e > 0) {
            tiles[num_tiles++] = e;
        }
    }

    int merged[4] = {0, 0, 0, 0};
    int m_idx = 0;
    double score = 0.0;
    for (int i = 0; i < num_tiles; i++) {
        if (i + 1 < num_tiles && tiles[i] == tiles[i + 1]) {
            int new_exp = tiles[i] + 1;
            if (new_exp > 255) new_exp = 255;
            merged[m_idx++] = new_exp;
            if (new_exp < 53) {
                score += (double)(1ULL << new_exp);
            }
            i++;
        } else {
            merged[m_idx++] = tiles[i];
        }
    }

    *out_score = score;
    return (uint32_t)merged[0] |
           ((uint32_t)merged[1] << 8) |
           ((uint32_t)merged[2] << 16) |
           ((uint32_t)merged[3] << 24);
}

static inline uint32_t slide_left_row(uint32_t row, double *out_score) {
    if ((row & 0xF0F0F0F0U) == 0U) {
        uint32_t idx = pack_row16(row);
        *out_score = row_score_table[idx];
        return row_left_u32_table[idx];
    }
    return compute_slide_left_u32(row, out_score);
}

static inline uint32_t slide_right_row(uint32_t row, double *out_score) {
    if ((row & 0xF0F0F0F0U) == 0U) {
        uint32_t idx = pack_row16(row);
        *out_score = row_right_score_table[idx];
        return row_right_u32_table[idx];
    }
    double sc = 0.0;
    uint32_t rev = reverse_row_u32(row);
    uint32_t slid = compute_slide_left_u32(rev, &sc);
    *out_score = sc;
    return reverse_row_u32(slid);
}

// 4x4 byte-matrix transpose
static inline board_t transpose(board_t b) {
    uint32_t r0 = (uint32_t)(b.lo & 0xFFFFFFFFULL);
    uint32_t r1 = (uint32_t)(b.lo >> 32);
    uint32_t r2 = (uint32_t)(b.hi & 0xFFFFFFFFULL);
    uint32_t r3 = (uint32_t)(b.hi >> 32);

    uint32_t c0 = (r0 & 0xFFU) | ((r1 & 0xFFU) << 8) | ((r2 & 0xFFU) << 16) | ((r3 & 0xFFU) << 24);
    uint32_t c1 = ((r0 >> 8) & 0xFFU) | (((r1 >> 8) & 0xFFU) << 8) | (((r2 >> 8) & 0xFFU) << 16) | (((r3 >> 8) & 0xFFU) << 24);
    uint32_t c2 = ((r0 >> 16) & 0xFFU) | (((r1 >> 16) & 0xFFU) << 8) | (((r2 >> 16) & 0xFFU) << 16) | (((r3 >> 16) & 0xFFU) << 24);
    uint32_t c3 = (r0 >> 24) | (((r1 >> 24) & 0xFFU) << 8) | (((r2 >> 24) & 0xFFU) << 16) | (((r3 >> 24) & 0xFFU) << 24);

    board_t out;
    out.lo = (uint64_t)c0 | ((uint64_t)c1 << 32);
    out.hi = (uint64_t)c2 | ((uint64_t)c3 << 32);
    return out;
}

static inline int move_left(board_t b, board_t *out_b, double *out_score) {
    uint32_t r0 = (uint32_t)(b.lo & 0xFFFFFFFFULL);
    uint32_t r1 = (uint32_t)(b.lo >> 32);
    uint32_t r2 = (uint32_t)(b.hi & 0xFFFFFFFFULL);
    uint32_t r3 = (uint32_t)(b.hi >> 32);

    double s0, s1, s2, s3;
    uint32_t nr0 = slide_left_row(r0, &s0);
    uint32_t nr1 = slide_left_row(r1, &s1);
    uint32_t nr2 = slide_left_row(r2, &s2);
    uint32_t nr3 = slide_left_row(r3, &s3);

    uint64_t nlo = (uint64_t)nr0 | ((uint64_t)nr1 << 32);
    uint64_t nhi = (uint64_t)nr2 | ((uint64_t)nr3 << 32);
    if (nlo == b.lo && nhi == b.hi) return 0;

    out_b->lo = nlo;
    out_b->hi = nhi;
    *out_score = s0 + s1 + s2 + s3;
    return 1;
}

static inline int move_right(board_t b, board_t *out_b, double *out_score) {
    uint32_t r0 = (uint32_t)(b.lo & 0xFFFFFFFFULL);
    uint32_t r1 = (uint32_t)(b.lo >> 32);
    uint32_t r2 = (uint32_t)(b.hi & 0xFFFFFFFFULL);
    uint32_t r3 = (uint32_t)(b.hi >> 32);

    double s0, s1, s2, s3;
    uint32_t nr0 = slide_right_row(r0, &s0);
    uint32_t nr1 = slide_right_row(r1, &s1);
    uint32_t nr2 = slide_right_row(r2, &s2);
    uint32_t nr3 = slide_right_row(r3, &s3);

    uint64_t nlo = (uint64_t)nr0 | ((uint64_t)nr1 << 32);
    uint64_t nhi = (uint64_t)nr2 | ((uint64_t)nr3 << 32);
    if (nlo == b.lo && nhi == b.hi) return 0;

    out_b->lo = nlo;
    out_b->hi = nhi;
    *out_score = s0 + s1 + s2 + s3;
    return 1;
}

// execute move: 0=up, 1=right, 2=down, 3=left
static inline int execute_move(board_t b, int dir, board_t *out_b, double *out_score) {
    if (dir == 3) {
        return move_left(b, out_b, out_score);
    } else if (dir == 1) {
        return move_right(b, out_b, out_score);
    } else if (dir == 0) {
        board_t tb = transpose(b);
        board_t ntb;
        if (!move_left(tb, &ntb, out_score)) return 0;
        *out_b = transpose(ntb);
        return 1;
    } else if (dir == 2) {
        board_t tb = transpose(b);
        board_t ntb;
        if (!move_right(tb, &ntb, out_score)) return 0;
        *out_b = transpose(ntb);
        return 1;
    }
    return 0;
}

static inline uint64_t compute_zobrist_hash_bb(board_t b) {
    uint64_t h = 0;
    uint64_t lo = b.lo;
    for (int i = 0; i < 8; i++) {
        int exp = (int)(lo & 0xFFULL);
        if (exp < MAX_ZOBRIST_EXP) {
            h ^= zobrist_table[i][exp];
        } else {
            h ^= zobrist_table[i][MAX_ZOBRIST_EXP - 1] ^ ((uint64_t)exp * 0x9e3779b97f4a7c15ULL);
        }
        lo >>= 8;
    }
    uint64_t hi = b.hi;
    for (int i = 8; i < 16; i++) {
        int exp = (int)(hi & 0xFFULL);
        if (exp < MAX_ZOBRIST_EXP) {
            h ^= zobrist_table[i][exp];
        } else {
            h ^= zobrist_table[i][MAX_ZOBRIST_EXP - 1] ^ ((uint64_t)exp * 0x9e3779b97f4a7c15ULL);
        }
        hi >>= 8;
    }
    return h;
}

static inline int get_empty_cells_bb(board_t b, int *empty_indices) {
    int count = 0;
    uint64_t lo = b.lo;
    for (int i = 0; i < 8; i++) {
        if ((lo & 0xFFULL) == 0ULL) {
            empty_indices[count++] = i;
        }
        lo >>= 8;
    }
    uint64_t hi = b.hi;
    for (int i = 8; i < 16; i++) {
        if ((hi & 0xFFULL) == 0ULL) {
            empty_indices[count++] = i;
        }
        hi >>= 8;
    }
    return count;
}

static inline board_t spawn_tile(board_t b, int idx, int t_exp) {
    if (idx < 8) {
        b.lo |= ((uint64_t)t_exp << (idx * 8));
    } else {
        b.hi |= ((uint64_t)t_exp << ((idx - 8) * 8));
    }
    return b;
}

// checks if move vacates or reduces established top-left corner anchor
static inline int check_anchor_violation_bb(board_t old_b, board_t new_b) {
    int old_corner = (int)(old_b.lo & 0xFFULL);
    int new_corner = (int)(new_b.lo & 0xFFULL);
    if (old_corner >= 6 && new_corner < old_corner) {
        return 1;
    }
    return 0;
}

static inline double rank_tile_score(int r) {
    if (r <= 0) return 0.0;
    if (r >= 50) return (double)r * (double)(1ULL << 50);
    return (double)r * (double)(1ULL << r);
}

static inline double compute_eval_row_u32(uint32_t row) {
    double a0 = rank_tile_score((int)(row & 0xFFU));
    double a1 = rank_tile_score((int)((row >> 8) & 0xFFU));
    double a2 = rank_tile_score((int)((row >> 16) & 0xFFU));
    double a3 = rank_tile_score((int)((row >> 24) & 0xFFU));

    double score_desc = a0;
    score_desc += (a0 >= a1) ? (a0 + a1) : ((a0 - a1) * 12.0);
    if (a0 == a1 && a0 > 0.0) score_desc += a0;
    score_desc += (a1 >= a2) ? (a1 + a2) : ((a1 - a2) * 12.0);
    if (a1 == a2 && a1 > 0.0) score_desc += a1;
    score_desc += (a2 >= a3) ? (a2 + a3) : ((a2 - a3) * 12.0);
    if (a2 == a3 && a2 > 0.0) score_desc += a2;
    return score_desc;
}

static inline double eval_row(uint32_t row) {
    if ((row & 0xF0F0F0F0U) == 0U) {
        return score_map_desc[pack_row16(row)];
    }
    return compute_eval_row_u32(row);
}

static inline double evaluate_board_bb(board_t b) {
    board_t tb = transpose(b);
    uint32_t r0 = (uint32_t)(b.lo & 0xFFFFFFFFULL);
    uint32_t r1 = (uint32_t)(b.lo >> 32);
    uint32_t r2 = (uint32_t)(b.hi & 0xFFFFFFFFULL);
    uint32_t r3 = (uint32_t)(b.hi >> 32);

    uint32_t c0 = (uint32_t)(tb.lo & 0xFFFFFFFFULL);
    uint32_t c1 = (uint32_t)(tb.lo >> 32);
    uint32_t c2 = (uint32_t)(tb.hi & 0xFFFFFFFFULL);
    uint32_t c3 = (uint32_t)(tb.hi >> 32);

    return eval_row(r0) + eval_row(r1) + eval_row(r2) + eval_row(r3) +
           eval_row(c0) + eval_row(c1) + eval_row(c2) + eval_row(c3);
}

static inline int has_row_zero_or_pair(uint32_t row) {
    int c0 = (int)(row & 0xFFU);
    int c1 = (int)((row >> 8) & 0xFFU);
    int c2 = (int)((row >> 16) & 0xFFU);
    int c3 = (int)((row >> 24) & 0xFFU);
    if (c0 == 0 || c1 == 0 || c2 == 0 || c3 == 0) return 1;
    if (c0 == c1 || c1 == c2 || c2 == c3) return 1;
    return 0;
}

static inline int is_game_over_bb(board_t b) {
    if (has_row_zero_or_pair((uint32_t)(b.lo & 0xFFFFFFFFULL))) return 0;
    if (has_row_zero_or_pair((uint32_t)(b.lo >> 32))) return 0;
    if (has_row_zero_or_pair((uint32_t)(b.hi & 0xFFFFFFFFULL))) return 0;
    if (has_row_zero_or_pair((uint32_t)(b.hi >> 32))) return 0;

    board_t tb = transpose(b);
    if (has_row_zero_or_pair((uint32_t)(tb.lo & 0xFFFFFFFFULL))) return 0;
    if (has_row_zero_or_pair((uint32_t)(tb.lo >> 32))) return 0;
    if (has_row_zero_or_pair((uint32_t)(tb.hi & 0xFFFFFFFFULL))) return 0;
    if (has_row_zero_or_pair((uint32_t)(tb.hi >> 32))) return 0;

    return 1;
}

static int is_initialized = 0;

static double expectimax_chance(board_t b, int depth, double prob);

static double expectimax_max(board_t b, int depth, double prob) {
    if (depth <= 0 || is_game_over_bb(b)) {
        nodes_evaluated++;
        return evaluate_board_bb(b);
    }

    uint64_t hash = compute_zobrist_hash_bb(b);
    uint32_t tt_idx = (uint32_t)(hash & TT_MASK);
    tt_entry_t *entry = &transposition_table[tt_idx];

    if (entry->key == hash && entry->depth >= depth &&
        (double)entry->prob >= prob * (1.0 - 1e-6)) {
        tt_hits_count++;
        return entry->value;
    }

    double best = -1e30;
    int has_valid_move = 0;

    static const int search_dirs[4] = {0, 3, 1, 2};
    for (int i = 0; i < 4; i++) {
        int dir = search_dirs[i];
        board_t next_b;
        double move_score = 0.0;
        if (!execute_move(b, dir, &next_b, &move_score)) continue;

        has_valid_move = 1;
        double penalty = check_anchor_violation_bb(b, next_b) ? -ANCHOR_PENALTY : 0.0;
        double val = penalty + expectimax_chance(next_b, depth - 1, prob);
        if (val > best) best = val;
    }

    double final_val = has_valid_move ? best : evaluate_board_bb(b);

    if (entry->key == hash) {
        if (depth > entry->depth || (depth == entry->depth && prob > (double)entry->prob)) {
            entry->depth = (int8_t)depth;
            entry->value = final_val;
            entry->prob = (float)prob;
            entry->age = current_search_age;
        }
    } else if (entry->age != current_search_age || depth >= entry->depth) {
        entry->key = hash;
        entry->depth = (int8_t)depth;
        entry->value = final_val;
        entry->prob = (float)prob;
        entry->age = current_search_age;
    }

    return final_val;
}

static double expectimax_chance(board_t b, int depth, double prob) {
    int empty_indices[16];
    int empty_count = get_empty_cells_bb(b, empty_indices);

    if (empty_count == 0) {
        nodes_evaluated++;
        return evaluate_board_bb(b);
    }

    double avg = 0.0;
    double weight_sum = 0.0;
    double cell_prob = prob / (double)empty_count;

    for (int i = 0; i < empty_count; i++) {
        int cell = empty_indices[i];

        double branch_prob_2 = cell_prob * 0.9;
        if (branch_prob_2 >= PROB_THRESHOLD) {
            board_t b2 = spawn_tile(b, cell, 1);
            double child_val_2 = expectimax_max(b2, depth, branch_prob_2);
            avg += 0.9 * child_val_2;
            weight_sum += 0.9;
        }

        double branch_prob_4 = cell_prob * 0.1;
        if (branch_prob_4 >= PROB_THRESHOLD) {
            board_t b4 = spawn_tile(b, cell, 2);
            double child_val_4 = expectimax_max(b4, depth, branch_prob_4);
            avg += 0.1 * child_val_4;
            weight_sum += 0.1;
        }
    }

    if (weight_sum > 0.0) {
        return avg / weight_sum;
    } else {
        nodes_evaluated++;
        return evaluate_board_bb(b);
    }
}

static inline board_t unpack_legacy_u64(uint64_t bb) {
    board_t b = {0ULL, 0ULL};
    for (int i = 0; i < 8; i++) {
        uint64_t exp = (bb >> (i * 4)) & 0xFULL;
        b.lo |= (exp << (i * 8));
    }
    for (int i = 8; i < 16; i++) {
        uint64_t exp = (bb >> (i * 4)) & 0xFULL;
        b.hi |= (exp << ((i - 8) * 8));
    }
    return b;
}

static inline board_t read_shared_board(void) {
    board_t b;
    b.lo = ((uint64_t)shared_board_buf[0]) |
           ((uint64_t)shared_board_buf[1] << 8) |
           ((uint64_t)shared_board_buf[2] << 16) |
           ((uint64_t)shared_board_buf[3] << 24) |
           ((uint64_t)shared_board_buf[4] << 32) |
           ((uint64_t)shared_board_buf[5] << 40) |
           ((uint64_t)shared_board_buf[6] << 48) |
           ((uint64_t)shared_board_buf[7] << 56);
    b.hi = ((uint64_t)shared_board_buf[8]) |
           ((uint64_t)shared_board_buf[9] << 8) |
           ((uint64_t)shared_board_buf[10] << 16) |
           ((uint64_t)shared_board_buf[11] << 24) |
           ((uint64_t)shared_board_buf[12] << 32) |
           ((uint64_t)shared_board_buf[13] << 40) |
           ((uint64_t)shared_board_buf[14] << 48) |
           ((uint64_t)shared_board_buf[15] << 56);
    return b;
}

int wasm_init(void);

static inline uint32_t rev_bytes32(uint32_t r) {
    return ((r & 0x000000FFU) << 24) |
           ((r & 0x0000FF00U) << 8)  |
           ((r & 0x00FF0000U) >> 8)  |
           ((r & 0xFF000000U) >> 24);
}

// map corner (0=tl, 1=tr, 2=bl, 3=br) into canonical top-left [0][0] frame
static inline board_t orient_board_bb(board_t b, int corner) {
    if (corner == 0) return b;
    uint32_t r0 = (uint32_t)(b.lo & 0xFFFFFFFFULL);
    uint32_t r1 = (uint32_t)(b.lo >> 32);
    uint32_t r2 = (uint32_t)(b.hi & 0xFFFFFFFFULL);
    uint32_t r3 = (uint32_t)(b.hi >> 32);
    board_t out;
    if (corner == 1) {
        out.lo = (uint64_t)rev_bytes32(r0) | ((uint64_t)rev_bytes32(r1) << 32);
        out.hi = (uint64_t)rev_bytes32(r2) | ((uint64_t)rev_bytes32(r3) << 32);
    } else if (corner == 2) {
        out.lo = (uint64_t)r3 | ((uint64_t)r2 << 32);
        out.hi = (uint64_t)r1 | ((uint64_t)r0 << 32);
    } else {
        out.lo = (uint64_t)rev_bytes32(r3) | ((uint64_t)rev_bytes32(r2) << 32);
        out.hi = (uint64_t)rev_bytes32(r1) | ((uint64_t)rev_bytes32(r0) << 32);
    }
    return out;
}

static int choose_anchor_corner_bb(board_t b) {
    int corners[4];
    corners[0] = (int)(b.lo & 0xFFULL);
    corners[1] = (int)((b.lo >> 24) & 0xFFULL);
    corners[2] = (int)((b.hi >> 32) & 0xFFULL);
    corners[3] = (int)((b.hi >> 56) & 0xFFULL);

    int max_c = corners[0];
    for (int i = 1; i < 4; i++) {
        if (corners[i] > max_c) max_c = corners[i];
    }
    if (max_c < 6) return 0;

    int best_corner = 0;
    double best_eval = -1e30;
    int have_best = 0;
    for (int c = 0; c < 4; c++) {
        if (corners[c] == max_c) {
            double ev = evaluate_board_bb(orient_board_bb(b, c));
            if (!have_best || ev > best_eval) {
                best_eval = ev;
                best_corner = c;
                have_best = 1;
            }
        }
    }
    return best_corner;
}

static int search_internal(board_t board, int depth) {
    if (!is_initialized) {
        wasm_init();
    }

    nodes_evaluated = 0;
    tt_hits_count = 0;
    current_search_age = (uint8_t)((current_search_age + 1) & 0xFF);

    static const int corner_dir_map[4][4] = {
        {0, 1, 2, 3},
        {0, 3, 2, 1},
        {2, 1, 0, 3},
        {2, 3, 0, 1}
    };
    int corner = choose_anchor_corner_bb(board);
    board_t canon_board = orient_board_bb(board, corner);

    last_best_dir = -1;
    double best_val = -1e30;

    static const int search_dirs[4] = {0, 3, 1, 2};
    for (int i = 0; i < 4; i++) {
        int canon_dir = search_dirs[i];
        int orig_dir = corner_dir_map[corner][canon_dir];
        board_t next_b;
        double move_score = 0.0;
        if (!execute_move(canon_board, canon_dir, &next_b, &move_score)) {
            last_dir_valid[orig_dir] = 0;
            last_dir_values[orig_dir] = -1e30;
            continue;
        }

        double penalty = check_anchor_violation_bb(canon_board, next_b) ? -ANCHOR_PENALTY : 0.0;
        double val = penalty + expectimax_chance(next_b, depth - 1, 1.0);
        last_dir_valid[orig_dir] = 1;
        last_dir_values[orig_dir] = val;

        if (val > best_val) {
            best_val = val;
            last_best_dir = orig_dir;
        }
    }

    return last_best_dir;
}

// exported webassembly interface functions

WASM_EXPORT(wasm_init)
int wasm_init(void) {
    for (uint32_t row = 0; row < 65536; row++) {
        uint32_t u32_row = unpack_row16((uint16_t)row);
        score_map_desc[row] = compute_eval_row_u32(u32_row);

        double score = 0.0;
        row_left_u32_table[row] = compute_slide_left_u32(u32_row, &score);
        row_score_table[row] = score;
    }

    for (uint32_t row = 0; row < 65536; row++) {
        uint16_t rev = reverse_row16((uint16_t)row);
        row_right_u32_table[row] = reverse_row_u32(row_left_u32_table[rev]);
        row_right_score_table[row] = row_score_table[rev];
    }

    prng_seed = 0x853c49e6748fea9bULL;
    for (int pos = 0; pos < 16; pos++) {
        for (int exp = 0; exp < MAX_ZOBRIST_EXP; exp++) {
            zobrist_table[pos][exp] = splitmix64();
        }
    }

    for (int i = 0; i < TT_SIZE; i++) {
        transposition_table[i].key = 0;
        transposition_table[i].value = 0.0;
        transposition_table[i].prob = 0.0f;
        transposition_table[i].depth = 0;
        transposition_table[i].age = 0;
    }
    current_search_age = 0;
    nodes_evaluated = 0;
    tt_hits_count = 0;
    for (int d = 0; d < 4; d++) {
        last_dir_valid[d] = 0;
        last_dir_values[d] = -1e30;
    }
    is_initialized = 1;

    return 1;
}

WASM_EXPORT(wasm_get_board_ptr)
int wasm_get_board_ptr(void) {
    return (int)(unsigned long)shared_board_buf;
}

WASM_EXPORT(wasm_search_buf)
int wasm_search_buf(int depth) {
    return search_internal(read_shared_board(), depth);
}

WASM_EXPORT(wasm_evaluate_buf)
double wasm_evaluate_buf(void) {
    if (!is_initialized) wasm_init();
    return evaluate_board_bb(read_shared_board());
}

WASM_EXPORT(wasm_search)
int wasm_search(uint64_t board, int depth) {
    return search_internal(unpack_legacy_u64(board), depth);
}

WASM_EXPORT(wasm_evaluate_board)
double wasm_evaluate_board(uint32_t board_low, uint32_t board_high) {
    if (!is_initialized) wasm_init();
    uint64_t bb = ((uint64_t)board_high << 32) | (uint64_t)board_low;
    return evaluate_board_bb(unpack_legacy_u64(bb));
}

WASM_EXPORT(wasm_search_parts)
int wasm_search_parts(uint32_t board_low, uint32_t board_high, int depth) {
    uint64_t bb = ((uint64_t)board_high << 32) | (uint64_t)board_low;
    return search_internal(unpack_legacy_u64(bb), depth);
}

WASM_EXPORT(wasm_is_dir_valid)
int wasm_is_dir_valid(int dir) {
    if (dir < 0 || dir >= 4) return 0;
    return last_dir_valid[dir];
}

WASM_EXPORT(wasm_get_dir_val)
double wasm_get_dir_val(int dir) {
    if (dir < 0 || dir >= 4) return -1e30;
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