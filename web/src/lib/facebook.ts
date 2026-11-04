import { config } from '../config'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    FB?: any
    fbAsyncInit?: () => void
  }
}

let sdkPromise: Promise<any> | null = null

/** Origens que podem enviar o resultado do Embedded Signup (allowlist exata, só HTTPS). */
const ES_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'])

export function loadFacebookSdk(): Promise<any> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    if (!config.fbAppId) {
      reject(new Error('VITE_FB_APP_ID não configurado.'))
      return
    }
    if (window.FB) {
      resolve(window.FB)
      return
    }
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: config.fbAppId,
        autoLogAppEvents: true,
        xfbml: false,
        version: config.graphVersion,
      })
      resolve(window.FB)
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/en_US/sdk.js'
    s.async = true
    s.defer = true
    s.crossOrigin = 'anonymous'
    s.onerror = () => {
      sdkPromise = null
      reject(new Error('Não foi possível carregar o SDK do Facebook (bloqueador de anúncios?).'))
    }
    document.body.appendChild(s)
  })
  return sdkPromise
}

export interface EmbeddedSignupResult {
  code: string
  waba_id: string | null
  phone_number_id: string | null
  business_id: string | null
  event: string | null
  session_info: unknown
}

export class EmbeddedSignupCancelled extends Error {
  step: string | null
  constructor(step: string | null) {
    super(step ? `Cadastro cancelado na etapa: ${step}` : 'Cadastro cancelado.')
    this.name = 'EmbeddedSignupCancelled'
    this.step = step
  }
}

/**
 * Abre o fluxo de Embedded Signup do WhatsApp.
 * Junta duas fontes: o `code` (callback do FB.login) e o session info
 * (postMessage WA_EMBEDDED_SIGNUP com waba_id / phone_number_id).
 */
export async function launchEmbeddedSignup(): Promise<EmbeddedSignupResult> {
  if (!config.fbEsConfigId) throw new Error('VITE_FB_ES_CONFIG_ID não configurado.')
  const FB = await loadFacebookSdk()

  return new Promise((resolve, reject) => {
    let code: string | null = null
    let info: { waba_id?: string; phone_number_id?: string; business_id?: string } | null = null
    let event: string | null = null
    let rawInfo: unknown = null
    let settled = false
    let waitTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      if (waitTimer) clearTimeout(waitTimer)
    }

    const finish = () => {
      if (settled || !code) return
      // Espera o session info chegar (pode vir antes ou depois do code)
      if (!info) {
        if (!waitTimer) waitTimer = setTimeout(() => done(), 4000)
        return
      }
      done()
    }

    const done = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        code: code!,
        waba_id: info?.waba_id ?? null,
        phone_number_id: info?.phone_number_id ?? null,
        business_id: info?.business_id ?? null,
        event,
        session_info: rawInfo,
      })
    }

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    function onMessage(e: MessageEvent) {
      if (!ES_ORIGINS.has(e.origin)) return
      let data: any = e.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return
        }
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      rawInfo = data
      event = data.event ?? null
      if (typeof event === 'string' && event.startsWith('FINISH')) {
        info = data.data ?? {}
        finish()
      } else if (event === 'CANCEL') {
        fail(new EmbeddedSignupCancelled(data.data?.current_step ?? null))
      } else if (event === 'ERROR') {
        fail(new Error(data.data?.error_message ?? 'Erro no Embedded Signup.'))
      }
    }

    window.addEventListener('message', onMessage)

    // O callback do FB.login NÃO pode ser async.
    FB.login(
      (response: any) => {
        const c = response?.authResponse?.code
        if (c) {
          code = c
          finish()
        } else {
          fail(new EmbeddedSignupCancelled(null))
        }
      },
      {
        config_id: config.fbEsConfigId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
        },
      },
    )
  })
}
