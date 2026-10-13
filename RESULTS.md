# results

training results, model performance, and score comparisons.

this file gets updated after each training run on kaggle and after significant local testing.

---

## baseline

heuristic-only ai (expectimax with handcrafted evaluation):
- games played: 500
- average score: 19815
- max tile reached: 4096 (14 games)
- score range: 0 - 62144
- tile distribution: 128 (1), 256 (13), 512 (95), 1024 (214), 2048 (163), 4096 (14)

---

## model v1

neural network board evaluator (16 -> dense 128 relu -> dense 64 relu -> 1 linear):
- dataset: 548337 board states (493503 train / 54834 val)
- training: 50 epochs, batch size 256, adam (lr=0.001), loss=mse
- training loss (mse): 0.0216 | training mae: 0.1129
- validation loss (mse): 0.0223 | validation mae: 0.1153 (~7162 score units)
- exported format: tensorflow.js layers model (model.json + group1-shard1of1.bin)

---

## comparisons

| version | avg score | max tile reached | games played | notes |
|---------|-----------|------------------|--------------|-------|
| heuristic only | 19815 | 4096 | 500 | hand-crafted evaluation |
| model v1 | 19800+ | 4096 | 500+ | neural network evaluation |

---

## local learning observations

tracks how the model refines weights client-side per-user:
- fine-tunes 2 gradient descent steps after every completed game
- persists updated weights directly to browser localstorage
- automatically reloaded on return visits