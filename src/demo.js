const titles = ['微光', '静海', 'After the rain', '凌晨四点', '缓慢经过', '远山', 'Lost in a moment', '留白']
export const demoLibrary = ['夜航计划', '日落以后', '独处的频率'].map((title, row) => ({
  id: `demo:${row}`, title, kind: 'favorite', group: 'owned', owner: 'CONOVA · 交互样本', count: 8,
  tracks: titles.map((name, index) => ({ id: `demo:${row}:${index}`, title: titles[(index + row * 2) % titles.length], artist: 'CONOVA · 原创氛围音', duration: 60, cover: `/covers/${(index + row * 3) % 12}.jpg`, demo: true })),
}))
