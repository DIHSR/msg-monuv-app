function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`[config] Variável de ambiente ausente: ${name}`)
    return ''
  }
  return value
}

export const config = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
  n8nBaseUrl: required('VITE_N8N_BASE_URL', import.meta.env.VITE_N8N_BASE_URL).replace(/\/+$/, ''),
  fbAppId: import.meta.env.VITE_FB_APP_ID ?? '',
  fbEsConfigId: import.meta.env.VITE_FB_ES_CONFIG_ID ?? '',
  graphVersion: import.meta.env.VITE_GRAPH_VERSION ?? 'v24.0',
}

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
  lastUpdated: '04/11/2026',
}
