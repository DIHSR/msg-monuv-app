/** Variáveis públicas do front (vão para o bundle). Ver web/.env.example. */
const env = import.meta.env

export const config = {
  supabaseUrl: (env.VITE_SUPABASE_URL ?? '').trim(),
  supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
  n8nApiUrl: (env.VITE_N8N_API_URL ?? '').trim().replace(/\/+$/, ''),
  metaAppId: (env.VITE_META_APP_ID ?? '').trim(),
  metaConfigId: (env.VITE_META_CONFIG_ID ?? '').trim(),
  graphVersion: (env.VITE_GRAPH_VERSION ?? 'v24.0').trim(),
}

/** Sem estas o app não funciona (a tela de configuração lista as que faltam). */
export function missingConfig(): string[] {
  const required: [string, string][] = [
    ['VITE_SUPABASE_URL', config.supabaseUrl],
    ['VITE_SUPABASE_ANON_KEY', config.supabaseAnonKey],
    ['VITE_N8N_API_URL', config.n8nApiUrl],
  ]
  return required.filter(([, v]) => !v).map(([k]) => k)
}

/** O Embedded Signup precisa destas duas; sem elas só o botão de conectar fica desativado. */
export const embeddedSignupConfigured = () => !!config.metaAppId && !!config.metaConfigId

/**
 * Dados da empresa usados nas páginas legais (Privacidade, Termos, Exclusão de Dados).
 * TODO: preencher com os dados reais antes de submeter ao App Review.
 */
export const company = {
  productName: 'Monuv Mensagens',
  legalName: 'Monuv [RAZÃO SOCIAL]',
  cnpj: '[CNPJ]',
  address: '[ENDEREÇO COMPLETO]',
  contactEmail: '[E-MAIL DE CONTATO]',
  privacyEmail: '[E-MAIL DO ENCARREGADO / DPO]',
  website: 'https://monuv.com.br',
  lastUpdated: '13/11/2026',
}
