import { native } from './api'

export const MODES = [{ id: 'sequence', title: '顺序播放' }, { id: 'shuffle', title: '随机播放' }, { id: 'single', title: '单曲循环' }]

export function CenterView({ vm: v }) {
  const back = (target) => <button className="text-option back" onClick={() => v.openView(target)}>返回</button>
  return <section className={`center-view view-${v.view}`} key={v.view} aria-label="设置" onPointerDown={(event) => event.stopPropagation()}>
    {v.view === 'welcome' && <div className="text-menu">
      <button className="text-option" onClick={v.generateQr} disabled={!v.ready || !!v.busy}>扫码登录</button>
      {window.conova && <button className="text-option" onClick={v.accountLogin} disabled={!!v.busy}>账号登录</button>}
    </div>}

    {v.view === 'login' && <>
      <div className={`qr-code ${v.qrStatus === 'expired' ? 'expired' : ''}`}>
        {v.qr ? <img src={v.qr.image} alt="B 站登录二维码" /> : <span className="loading-square" aria-label="正在获取二维码" />}
        {v.qrStatus === 'expired' && <button className="qr-refresh" onClick={v.generateQr}>重新获取</button>}
      </div>
      <p className="qr-state">{v.busy === 'account' ? '等待账号登录' : v.qrStatus === 'scanned' ? '请在手机上确认' : v.qrStatus === 'expired' ? '二维码已过期' : '等待扫码'}</p>
      <div className="text-menu compact-menu">
        <button className="text-option" onClick={v.generateQr} disabled={!!v.busy}>刷新二维码</button>
        {window.conova && <button className="text-option" onClick={v.accountLogin} disabled={!!v.busy}>账号登录</button>}
        {back(v.library.length ? 'settings' : 'welcome')}
      </div>
    </>}

    {v.view === 'controls' && <div className="text-menu">
      <div className="mode-options">{MODES.map(({ id, title }) => <button key={id} className={`text-option ${v.mode === id ? 'selected' : ''}`} aria-pressed={v.mode === id} onClick={() => { v.setMode(id); v.openView(null) }}>{title}</button>)}</div>
      <button className="text-option" onClick={() => v.openView('manage')}>管理专辑</button>
      <button className="text-option" onClick={() => v.openView('settings')}>设置</button>
      {back(null)}
    </div>}

    {v.view === 'settings' && <div className="text-menu">
      <label className="setting-line"><span>音量</span><input type="range" aria-label="音量" min="0" max="1" step="0.01" value={v.player.volume} onChange={(event) => v.player.setVolume(Number(event.target.value))} style={{ '--progress': `${v.player.volume * 100}%` }} /></label>
      <button className="text-option setting-line" aria-pressed={v.autoSync} onClick={() => v.setAutoSync((value) => !value)}>自动同步<span className={`selection-mark ${v.autoSync ? 'checked' : ''}`} /></button>
      <button className="text-option" onClick={() => v.sync(false)} disabled={!!v.busy || v.demo}>{v.busy === 'sync' ? '正在刷新' : '刷新专辑'}</button>
      <button className="text-option" onClick={() => v.openView('account')}>账号</button>
      {native && <button className="text-option" onClick={() => v.openView('service')}>连接设置</button>}
      {back('controls')}
    </div>}

    {v.view === 'manage' && <>
      {!v.user || v.demo ? <div className="text-menu"><button className="text-option" onClick={v.generateQr}>扫码登录</button>{window.conova && <button className="text-option" onClick={v.accountLogin}>账号登录</button>}</div> : <>
        <div className="source-tabs"><button className={`text-option ${v.sourceTab === 'owned' ? 'selected' : ''}`} onClick={() => v.setSourceTab('owned')}>我的收藏夹</button><button className={`text-option ${v.sourceTab === 'followed' ? 'selected' : ''}`} onClick={() => v.setSourceTab('followed')}>我追的合集/收藏夹</button></div>
        <div className="source-list scroll-area">
          {v.sourceLoading ? <span className="status-text">正在读取</span> : v.sources[v.sourceTab].length ? v.sources[v.sourceTab].map((source) => {
            const added = v.library.some((item) => item.id === source.id)
            return <button className="text-option source-item" key={source.id} disabled={!!v.busy} aria-pressed={added} onClick={() => v.toggleSource(source)}><span>{source.title}</span><span className={`selection-mark ${added ? 'checked' : ''} ${v.busy === source.id ? 'working' : ''}`} /></button>
          }) : <span className="status-text">暂无收藏</span>}
        </div>
        <button className="text-option" onClick={v.loadSources} disabled={!!v.busy}>刷新列表</button>
      </>}
      {back(v.library.length ? null : 'welcome')}
    </>}

    {v.view === 'account' && <div className="text-menu">
      {v.user && <span className="account-name">{v.user.name}</span>}
      {!v.user && <button className="text-option" onClick={v.generateQr}>扫码登录</button>}
      {window.conova && !v.user && <button className="text-option" onClick={v.accountLogin} disabled={!!v.busy}>账号登录</button>}
      {(v.user || v.demo) && <button className="text-option" onClick={v.logout} disabled={!!v.busy}>{v.demo ? '退出体验' : '退出登录'}</button>}
      {back('settings')}
    </div>}

    {v.view === 'service' && <>
      <form className="service-form" onSubmit={(event) => { event.preventDefault(); v.connectService() }}>
        <label htmlFor="service-url">服务地址</label>
        <input id="service-url" type="url" value={v.service} onChange={(event) => v.setService(event.target.value)} placeholder="https://" required />
        <button className="text-option" disabled={!!v.busy}>连接</button>
      </form>
      {v.library.length > 0 && back('settings')}
    </>}

    {v.view === 'error' && <>
      <p className="inline-message" role="status">{v.message}</p>
      <div className="text-menu"><button className="text-option" onClick={() => { v.openView(null); v.player.load(v.track, true) }} disabled={!v.track}>重试</button><button className="text-option" onClick={() => v.advance(1, { autoplay: true })}>下一首</button>{back(v.library.length ? null : 'welcome')}</div>
    </>}

    {v.message && v.view !== 'error' && <p className="inline-message" role="status">{v.message}</p>}
  </section>
}
