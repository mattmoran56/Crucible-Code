import { randomInt } from 'node:crypto'
import Store from 'electron-store'

/**
 * Word handle generator for the hosted relay variant.
 *
 * The handle is a 3-word lowercase hyphenated identifier (e.g. `tiger-violet-cobalt`)
 * that the user types on the phone alongside the pairing code. It is persisted
 * per-install and can be rotated from settings (which also rolls the relay
 * auth token so the old handle/token pair is invalidated server-side on
 * next register).
 */

const WORDS = [
  'amber','apple','arrow','aspen','atlas','aurora','autumn','azure',
  'basil','beach','berry','birch','bison','blade','blaze','bloom',
  'blue','boar','bold','bongo','boson','brass','breeze','briar',
  'bronze','brook','calm','candle','cedar','chalk','charm','chase',
  'cherry','cinder','clay','clever','cliff','cloud','clover','cobalt',
  'comet','copper','coral','cosmic','cove','crane','crimson','crystal',
  'cypress','daisy','dawn','delta','desert','dew','diamond','dolphin',
  'drift','dune','dusk','eagle','earth','echo','ember','emerald',
  'falcon','fawn','feather','fern','fig','finch','fire','flame',
  'flax','flint','flora','flute','forest','fox','fresh','frost',
  'galaxy','garnet','gemini','ginger','glacier','glade','glass','gleam',
  'glow','golden','granite','grape','grove','hare','hazel','heron',
  'hill','holly','horizon','iris','ivory','ivy','jade','jasper',
  'juniper','kestrel','kite','lake','lark','laurel','lava','leaf',
  'lemon','linen','lion','lotus','lumen','lunar','lynx','magnet',
  'maple','marble','marsh','meadow','melon','mesa','metal','meteor',
  'mint','mist','moon','moss','mountain','nebula','neon','nest',
  'noble','north','oak','ocean','olive','onyx','opal','orange',
  'orbit','otter','owl','panda','pearl','pebble','phoenix','pine',
  'pixel','planet','plum','poet','pollen','pond','poppy','prairie',
  'prism','pulse','quail','quartz','quasar','quill','quince','quiver',
  'rabbit','rain','raven','reed','reef','river','robin','rose',
  'ruby','sage','salmon','sand','sapphire','satin','scarlet','seal',
  'shade','shore','silver','sky','slate','snow','solar','sonic',
  'sorrel','sparrow','spice','spring','spruce','star','stone','storm',
  'stream','summer','sunset','swan','swift','tangent','teal','thorn',
  'thunder','tiger','timber','topaz','torch','trail','tulip','umber',
  'valley','vega','velvet','vermilion','vibe','vine','violet','volt',
  'walnut','wave','willow','winter','wolf','woven','yarrow','yew',
  'zen','zephyr','zinc'
]

export interface CloudHandleState {
  handle: string
  token: string
}

const store = new Store<{ cloudHandle: string | null; cloudAuthToken: string | null }>({
  name: 'remote-cloud-settings',
  defaults: { cloudHandle: null, cloudAuthToken: null },
})

function pick(): string {
  const w = (): string => WORDS[randomInt(0, WORDS.length)]!
  return `${w()}-${w()}-${w()}`
}

export function getCurrentHandle(): string | null {
  return store.get('cloudHandle', null)
}

export function getCurrentToken(): string | null {
  return store.get('cloudAuthToken', null)
}

export function setRegistered(handle: string, token: string): void {
  store.set('cloudHandle', handle)
  store.set('cloudAuthToken', token)
}

/** Generate a *candidate* handle. The backend `/register` may reject it (409
 *  if currently held by a different desktop) — caller retries with a new one. */
export function generateCandidateHandle(): string {
  return pick()
}

export function clearHandle(): void {
  store.set('cloudHandle', null)
  store.set('cloudAuthToken', null)
}
