import { emitGuestEvent } from '@/jsapi/host'
import { useT } from '@/store/app'
import { simulatorActions, useSimulator, type NavItem } from '@/store/simulator'
import { BackIcon, MoreIcon } from './icons'

/** Simulated Feishu H5 container navigation bar (§2.1): Back / Close · title · More. */
export function NavBar() {
  const t = useT()
  const navBar = useSimulator((s) => s.navBar)
  const pageTitle = useSimulator((s) => s.title)
  const setActionSheet = useSimulator((s) => s.setActionSheet)

  const openMore = () => {
    const menu = navBar.menu?.filter((m) => m.text) ?? []
    const items = [...menu.map((m) => m.text ?? ''), t('simulator.refresh')]
    setActionSheet({
      items,
      resolve: (index) => {
        if (index === null) return
        if (index < menu.length)
          emitGuestEvent('onMenuItemClick', {
            id: menu[index]?.id ?? '',
            text: menu[index]?.text ?? ''
          })
        else simulatorActions.reload()
      }
    })
  }

  const renderItem = (item: NavItem, side: 'left' | 'right', index: number) => {
    const onClick = () => {
      if (item.control) {
        emitGuestEvent(side === 'left' ? 'onLeftNavigationBarClick' : 'onRightNavigationBarClick', {
          id: item.id ?? '',
          index
        })
        return
      }
      if (side === 'left') simulatorActions.goBack()
      else openMore()
    }
    return (
      <button
        key={`${side}-${index}`}
        type="button"
        className="navBtn"
        onClick={onClick}
        aria-label={
          item.text ? undefined : item.icon === 'back' ? t('simulator.back') : t('simulator.more')
        }
      >
        {item.imageBase64 ? (
          <img
            src={
              item.imageBase64.startsWith('data:')
                ? item.imageBase64
                : `data:image/png;base64,${item.imageBase64}`
            }
            alt=""
          />
        ) : null}
        {item.icon === 'back' && <BackIcon aria-hidden />}
        {item.text}
      </button>
    )
  }

  const left = navBar.left ?? [{ icon: 'back' as const, text: t('simulator.back') }]
  const right = navBar.right ?? [{ text: t('simulator.more') }]

  return (
    <div className="navigator">
      <div className="side left">
        {left.map((item, i) => renderItem(item, 'left', i))}
        {navBar.showClose && navBar.left === null && (
          <button type="button" className="navBtn" onClick={() => simulatorActions.close()}>
            {t('simulator.close')}
          </button>
        )}
      </div>
      <div className="title" title={navBar.title || pageTitle}>
        {navBar.title || pageTitle}
      </div>
      <div className="side right">
        {right.length ? (
          right.map((item, i) => renderItem(item, 'right', i))
        ) : (
          <button
            type="button"
            className="navBtn"
            onClick={openMore}
            aria-label={t('simulator.more')}
          >
            <MoreIcon aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
