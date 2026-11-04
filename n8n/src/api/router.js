// POST monuv/api — porta única do front. body: { action, ...parâmetros da ação }
// Autentica UMA vez e devolve `route` (índice da saída do Switch "Ação").
// ROUTES é injetado pelo build.mjs a partir da tabela de ações (uma decisão, um lugar).
const req = $input.first().json;
const ERROR_ROUTE = ROUTES.length;

try {
  const body = req.body || {};
  const route = ROUTES.indexOf(String(body.action || ''));
  if (route < 0) throw new HttpError(400, 'unknown_action', 'Ação desconhecida.');
  const user = await authUser(req);
  return [{ json: { route, user: { id: user.id, email: user.email }, body } }];
} catch (e) {
  const [res] = await handleError(e);
  return [{ json: { route: ERROR_ROUTE, ...res.json } }];
}
