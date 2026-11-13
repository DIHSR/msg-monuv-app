// Agendador (1x/min): alerta preventivo de inatividade da coexistência (lacuna 3).
// A Meta desconecta o número quando o app WhatsApp Business fica ~14 dias sem ser aberto no celular.
// Quem passa de ~10 dias sem atividade (last_seen_at) ganha inactivity_alert_at, e a tela de Conexões
// pede para abrir o app. A conta sai do alerta sozinha quando chega atividade nova.
const r = await rpc('refresh_inactivity_alerts', {});
return [{ json: { at: new Date().toISOString(), ...r } }];
