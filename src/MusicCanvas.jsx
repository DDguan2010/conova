import { coverUrl } from './api'
import { Waveform } from './Waveform'
import { CenterView } from './CenterView'
import { scatterPosition } from './motion'
import { useTileMotion } from './useTileMotion'
import { SeekBar } from './SeekBar'

export function MusicCanvas({ player, view, mode, tiles, tileSize, step, sceneSize, scattered, scene, vm, beginGesture, moveGesture, endGesture, suppressClick, holdTimer, gesture, select, track, openView }) {
  const targets = tiles.map((tile) => {
    const position = scattered && !(mode === 'single' && !view && tile.active)
      ? scatterPosition(tile, sceneSize.width, sceneSize.height, tileSize)
      : { x: tile.x * step, y: tile.y * step }
    return { key: tile.key, ...position, scale: tile.active && !view ? 1.27 : 1 }
  })
  const registerTile = useTileMotion(targets, scene)
  const resetGesture = () => {
    clearTimeout(holdTimer.current)
    gesture.current = null
    scene.current?.removeAttribute('data-dragging')
    scene.current?.style.setProperty('--drag-x', '0px')
    scene.current?.style.setProperty('--drag-y', '0px')
  }
  return <main className={`app ${player.playing ? 'playing' : 'paused'} ${scattered ? 'scattered' : ''} ${view ? 'has-view' : ''} ${mode === 'single' && !view ? 'single-mode' : ''}`}>
    <section className="album-scene" ref={scene} data-testid="album-scene" style={{ '--tile-size': `${tileSize}px` }} onPointerDown={(event) => { if (event.target === event.currentTarget || event.target.classList.contains('tile-layer')) beginGesture(event) }} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={resetGesture}>
      <div className="tile-layer" aria-hidden={Boolean(view)} inert={view ? true : undefined}>
        {tiles.map((tile, index) => {
          const { x, y } = targets[index]
          return <div ref={registerTile(tile.key)} className={`tile ${tile.active ? 'active' : ''} ${tile.placeholder ? 'placeholder' : ''}`} key={tile.key} style={{ '--x': `${x}px`, '--y': `${y}px`, '--tone': `${68 + Math.abs(tile.x * 13 + tile.y * 7) % 5 * 17}` }}>
            <button className="cover" data-testid={tile.active ? 'current-cover' : undefined} disabled={tile.placeholder} tabIndex={view ? -1 : 0} aria-label={tile.track ? `${tile.track.title}，${tile.track.artist}${tile.active ? '，点击播放或暂停，长按打开设置' : ''}` : undefined} aria-pressed={tile.active ? player.playing : undefined} onPointerDown={(event) => beginGesture(event, tile)} onContextMenu={(event) => { event.preventDefault(); if (!tile.placeholder) openView('controls') }} onClick={() => {
              if (suppressClick.current) { suppressClick.current = false; return }
              if (tile.active) player.toggle(track)
              else select(tile.row, tile.column, true)
            }}>
              {tile.track?.cover && <img src={coverUrl(tile.track.cover)} alt="" draggable="false" loading={tile.active ? 'eager' : 'lazy'} onError={(event) => { event.currentTarget.style.opacity = '0' }} />}
            </button>
            {tile.active && <div className="cover-audio" style={{ '--cover-art': `url("${coverUrl(tile.track.cover)}")` }} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()}>
              <Waveform player={player} cover={coverUrl(tile.track.cover)} />
              <SeekBar player={player} fallbackDuration={tile.track.duration} />
            </div>}
          </div>
        })}
      </div>
      {view && <CenterView vm={vm} />}
    </section>
  </main>
}
