import json
import matplotlib.pyplot as plt
import numpy as np
import os

json_path = 'benchmark/e2e-report.json'
if not os.path.exists(json_path):
    print(f"Error: {json_path} does not exist.")
    exit(1)

with open(json_path, 'r') as f:
    data = json.load(f)

sizes = []
for key in data.keys():
    if key.startswith('N='):
        sizes.append(int(key.split('=')[1]))
sizes.sort()

phase_labels = [
    'Propose 1', 'Propose 2', 
    'TSS 1', 'TSS 2', 'TSS 3', 'TSS 4', 
    'Settlement'
]

data_means = {N: [] for N in sizes}
data_stds = {N: [] for N in sizes}

for N in sizes:
    key = f'N={N}'
    
    transactions = data[key].get('transactions', [])
    phase_data = [[] for _ in range(7)]
    
    for tx in transactions:
        p1 = tx.get('propose', [0, 0])[0]
        p2 = tx.get('propose', [0, 0])[1]
        t1 = tx.get('tss', [0, 0, 0, 0])[0]
        t2 = tx.get('tss', [0, 0, 0, 0])[1]
        t3 = tx.get('tss', [0, 0, 0, 0])[2]
        t4 = tx.get('tss', [0, 0, 0, 0])[3]
        s1 = tx.get('settlement', [0])[0]
        
        phase_data[0].append(p1)
        phase_data[1].append(p2)
        phase_data[2].append(t1)
        phase_data[3].append(t2)
        phase_data[4].append(t3)
        phase_data[5].append(t4)
        phase_data[6].append(s1)
        
    for i in range(7):
        arr = phase_data[i]
        data_means[N].append(np.mean(arr) if arr else 0)
        data_stds[N].append(np.std(arr) if arr else 0)

# Grouped Bar Chart
plt.figure(figsize=(16, 7))

x = np.arange(len(phase_labels))
num_sizes = len(sizes)
width = 0.8 / num_sizes  # Allocate space for bars in a group

colors = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1']

for i, N in enumerate(sizes):
    pos = x - 0.4 + (i + 0.5) * width
    lower_err = np.minimum(data_means[N], data_stds[N])
    upper_err = data_stds[N]
    plt.bar(pos, data_means[N], width, 
            yerr=[lower_err, upper_err], label=f'N={N}', 
            color=colors[i % len(colors)], 
            capsize=4, edgecolor='black', linewidth=0.7, alpha=0.9)

plt.title('Transaction Execution Time (sample size: 20)', fontsize=18, fontweight='bold', pad=15)
plt.ylabel('Time (ms)', fontsize=14, fontweight='bold')
plt.xticks(x, phase_labels, fontsize=12, rotation=0)
plt.yticks(fontsize=12)
plt.grid(axis='y', linestyle='--', alpha=0.5)
plt.legend(title='Network Size', title_fontsize=14, fontsize=12, loc='upper right')

plt.tight_layout()
plt.savefig('benchmark/txs-plot.png', dpi=300, bbox_inches='tight')

# --- DKG Plot ---
dkg_phase_labels = ['DKG 1', 'DKG 2', 'DKG 3']
dkg_data = {N: data[f'N={N}'].get('dkg', [0, 0, 0]) for N in sizes}

plt.figure(figsize=(10, 6))
x_dkg = np.arange(len(dkg_phase_labels))

for i, N in enumerate(sizes):
    pos = x_dkg - 0.4 + (i + 0.5) * width
    plt.bar(pos, dkg_data[N], width, 
            label=f'N={N}', 
            color=colors[i % len(colors)], 
            edgecolor='black', linewidth=0.7, alpha=0.9)

plt.title('DKG Execution Time', fontsize=18, fontweight='bold', pad=15)
plt.ylabel('Time (ms)', fontsize=14, fontweight='bold')
plt.xticks(x_dkg, dkg_phase_labels, fontsize=12, rotation=0)
plt.yticks(fontsize=12)
plt.grid(axis='y', linestyle='--', alpha=0.5)
plt.legend(title='Network Size', title_fontsize=14, fontsize=12, loc='upper right')

plt.tight_layout()
plt.savefig('benchmark/dkg-plot.png', dpi=300, bbox_inches='tight')
