// Painel do catálogo ligado ao banco do Studio (Supabase), o mesmo que o programa usa.
// O painel (admin.html) continua igual: ele chama chamarBanco({acao: ...}) no lugar do Apps Script,
// e este arquivo traduz cada ação para a tabela "registros" (gravada só pela função gravar(), que
// confere login, permissão e versão no próprio banco).
//
// Como os produtos ficam no banco (igual ao programa):
//   aba "Produtos": cada opção (cor, volume...) é um produto com código próprio. As opções do mesmo
//   produto têm o mesmo "Pai" (código do produto) e a "Variacao" em JSON, ex. {"Cor":"Nude"}.
//   aba "ListasSite": marcas e categorias do site, com a ordem (Tipo, Nome, Situacao, Ordem).
//   aba "Encomendas": itens esgotados pedidos pelo site.
//   aba "Registro": histórico (o mesmo do programa).
// Nada é apagado: excluir marca Situacao "Inativo" (e ExcluidoNoPainel "Sim" para poder restaurar).
(function(){
const CFG = window.STUDIO_CONFIG || {};
const URL_BANCO = String(CFG.supabaseUrl || "").replace(/\/+$/, "");
const CHAVE = CFG.supabaseChave || "";
window.BANCO_ATIVO = !!(URL_BANCO && CHAVE);
const GUARDA = "studio_painel_banco";
const PASTA_FOTOS = "fotos-site";
const SEP = " – ";
const TIPOS_SITE = { cor: "Cor", tamanho: "Tamanho", voltagem: "Voltagem" };
const NAO_E_TIPO = /^(id do produto|id|ajuste|disponivel|imagem|foto|sub ?id|codigo|preco|obs)/;
const COLS_FOTO = ["Imagem (URL)", "Imagem 2 (URL)", "Imagem 3 (URL)", "Imagem 4 (URL)", "Imagem 5 (URL)"];
let auth = null;

// ---------- utilidades ----------
const sem = t => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max || 200);
const num = v => { const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const simNao = v => v ? "Sim" : "Não";
const ehSim = v => /^(s|sim|x|true|1|yes)$/i.test(String(v ?? "").trim());
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const erro = (msg, codigo) => Object.assign(new Error(msg), { doScript: true, codigo });
function agoraLocal(){
  // data/hora de Aracaju no formato do programa ({"$d": "2026-11-02T14:30:00"})
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return { "$d": d.toISOString().slice(0, 19) };
}
function dataBR(v){
  const s = v && typeof v === "object" ? v["$d"] : v;
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})T?(\d{2})?:?(\d{2})?/);
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}` : String(s || "");
}
function dataDoBR(t){
  const m = String(t || "").match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  return m ? { "$d": `${m[3]}-${m[2]}-${m[1]}T${m[4] || "00"}:${m[5] || "00"}:00` } : agoraLocal();
}
const precoDe = d => num(d.PrecoVarejo) > 0 ? num(d.PrecoVarejo) : num(d.Preco);
const codigoDe = d => { const n = Number(d && d.Codigo); return Number.isInteger(n) && n > 0 ? n : 0; };
const paiDe = d => { const n = parseInt(d && d.Pai, 10); return n > 0 ? n : 0; };
const ativo = d => (d.Situacao || "Ativo") !== "Inativo";
const ehLoja = d => !["Serviço", "Pacote"].includes(d.Tipo || "");
function variacaoDe(d){
  let v = d.Variacao;
  if(typeof v === "string"){ try{ v = JSON.parse(v); }catch(e){ v = null; } }
  const o = {};
  if(v && typeof v === "object" && !Array.isArray(v)) Object.entries(v).forEach(([k, x]) => { k = txt(k, 30); x = txt(x, 40); if(k && x) o[k] = x; });
  return o;
}
function tipoPadrao(t){ t = txt(t, 30); return TIPOS_SITE[sem(t)] || (t.slice(0, 1).toUpperCase() + t.slice(1)); }

// ---------- conexão ----------
function guardar(a){
  auth = a;
  try{ if(a) localStorage.setItem(GUARDA, JSON.stringify(a)); else localStorage.removeItem(GUARDA); }catch(e){}
}
function lerGuardado(){ if(auth) return auth; try{ auth = JSON.parse(localStorage.getItem(GUARDA) || "null"); }catch(e){ auth = null; } return auth; }
async function buscar(url, opcoes){
  try{ return await fetch(url, opcoes); }
  catch(e){ throw erro(navigator.onLine === false ? "Sem internet. Confira a conexão e tente de novo." : "O banco não respondeu. Confira a internet e tente de novo."); }
}
async function pedirAuth(caminho, corpo){
  const r = await buscar(`${URL_BANCO}/auth/v1/${caminho}`, { method: "POST", headers: { apikey: CHAVE, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  if(!r.ok){
    const m = String(d.error_description || d.msg || d.message || d.error_code || "");
    if(/invalid login|invalid_grant|credentials/i.test(m) || d.error === "invalid_grant") throw erro("E-mail ou senha errados.", "senha");
    if(/not confirmed/i.test(m)) throw erro("Confirme o e-mail antes de entrar (veja a caixa de entrada).", "senha");
    throw erro("Não consegui entrar: " + (m || r.status));
  }
  return { access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in || 3600) * 1000, email: (d.user && d.user.email) || (auth && auth.email) || "" };
}
async function token(){
  const a = lerGuardado();
  if(!a || !a.refresh_token) throw erro("Entre com seu e-mail e senha.", "senha");
  if(Date.now() > a.expira - 60000){
    try{ guardar(await pedirAuth("token?grant_type=refresh_token", { refresh_token: a.refresh_token })); }
    catch(e){ if(e.codigo === "senha" || /invalid/i.test(e.message)) { guardar(null); throw erro("Entre de novo com seu e-mail e senha.", "senha"); } throw e; }
  }
  return auth.access_token;
}
async function req(caminho, { metodo = "GET", corpo, cab = {} } = {}){
  const t = await token();
  const r = await buscar(URL_BANCO + caminho, { method: metodo, headers: Object.assign({ apikey: CHAVE, Authorization: "Bearer " + t, "Content-Type": "application/json" }, cab),
    body: corpo === undefined ? undefined : (corpo instanceof Blob ? corpo : JSON.stringify(corpo)) });
  const texto = await r.text();
  let d = null; try{ d = texto ? JSON.parse(texto) : null; }catch(e){ d = texto; }
  if(r.status === 401){ guardar(null); throw erro("Entre de novo com seu e-mail e senha.", "senha"); }
  if(!r.ok){
    const m = String((d && (d.message || d.msg || d.error)) || r.status);
    const e = erro(/conflito/i.test(m) || r.status === 409 ? "conflito" : /aprovada/i.test(m) ? "Esta conta ainda não foi aprovada no programa do Studio (Usuários › Contas)." :
      /permiss/i.test(m) ? "Esta conta não tem permissão para mudar produtos. Peça ao Admin no programa." : "O banco recusou: " + m);
    e.conflito = /conflito/i.test(m) || d && d.code === "40001";
    throw e;
  }
  return d;
}
const rpc = (nome, args) => req(`/rest/v1/rpc/${nome}`, { metodo: "POST", corpo: args || {} });

async function lerAbas(abas){
  const out = [];
  for(let de = 0; ; de += 1000){
    const q = `/rest/v1/registros?select=aba,id,dados&apagado=is.false&aba=in.(${abas.map(encodeURIComponent).join(",")})&order=versao.asc,id.asc&limit=1000&offset=${de}`;
    const pagina = await req(q);
    out.push(...pagina);
    if(pagina.length < 1000) break;
  }
  const por = {};
  abas.forEach(a => por[a] = []);
  out.forEach(r => { if(r.dados && typeof r.dados === "object" && por[r.aba]) por[r.aba].push({ id: r.id, d: r.dados }); });
  return por;
}

// Grava com a versão de agora; se outra pessoa (ou o programa) gravou no meio, lê de novo e refaz.
async function gravarComVersao(montar){
  for(let vez = 0; vez < 4; vez++){
    const base = await rpc("versao_atual");
    const { mudancas, resposta } = await montar();
    if(!mudancas.length) return resposta;
    try{ await rpc("gravar", { base, mudancas }); return resposta; }
    catch(e){ if(!e.conflito || vez === 3) throw e.conflito ? erro("O banco estava ocupado. Tente salvar de novo.") : e; }
  }
}
function registro(acao, detalhe){
  return { aba: "Registro", id: uuid(), dados: { Data: agoraLocal(), Computador: "Painel do site", Usuario: (auth && auth.email) || "", Acao: acao, Detalhe: String(detalhe || "").slice(0, 300) } };
}

// ---------- grupos de produtos ----------
function agrupar(produtos){
  const grupos = new Map();
  produtos.filter(r => ehLoja(r.d) && codigoDe(r.d)).forEach(r => {
    const k = paiDe(r.d) || codigoDe(r.d);
    if(!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  });
  grupos.forEach((l, k) => l.sort((a, b) => (codigoDe(a.d) !== k) - (codigoDe(b.d) !== k) || codigoDe(a.d) - codigoDe(b.d)));
  return grupos;
}
function resumoDoGrupo(id, lista){
  const ativos = lista.filter(r => ativo(r.d));
  const excluido = ativos.length === 0;
  // excluído: mostra as opções que estavam no site quando foi excluído (as marcadas)
  const marcados = lista.filter(r => r.d.ExcluidoNoPainel === "Sim");
  const vis = !excluido ? ativos : marcados.length ? marcados : lista;
  const comOpcoes = vis.some(r => paiDe(r.d) && Object.keys(variacaoDe(r.d)).length);
  const p = (vis[0] || lista[0]).d;
  const nome = txt(p.NomeSite, 120) || (comOpcoes ? txt(p.NomeBase, 120) : "") || txt(p.Nome, 120);
  const ops = comOpcoes ? vis.filter(r => Object.keys(variacaoDe(r.d)).length) : [];
  const precos = (ops.length ? ops : [vis[0] || lista[0]]).map(r => precoDe(r.d)).filter(n => n > 0);
  const base = precos.length ? Math.min(...precos) : 0;
  const fotos = String((comOpcoes ? p.FotosProduto : p.Fotos) || "").split(",").map(s => s.trim()).filter(Boolean);
  const linha = { "ID": id, "Produto": nome, "Marca": txt(p.Marca, 60), "Categoria": txt(p.Categoria, 60), "Preço (R$)": base,
    "Recomendado?": simNao(p.Destaque === "Sim"), "Novo?": simNao(p.Novo === "Sim"), "É Kit?": simNao(p.Kit === "Sim"), "Itens do Kit": p.ItensKit || "",
    "Oferta Especial?": simNao(p.Oferta === "Sim"), "Descrição": p.Descricao || "", "Preço anterior (R$)": num(p.PrecoAnterior) || "",
    "Situação": excluido ? "Excluído" : p.NoSite === "Não" ? "Fora do site" : (!comOpcoes && p.Esgotado === "Sim") ? "Esgotado" : "Ativo" };
  COLS_FOTO.forEach((c, n) => linha[c] = fotos[n] || "");
  const opcoes = ops.map(r => Object.assign({ "ID do produto": id, "Ajuste de preço": Math.round((precoDe(r.d) - base) * 100) / 100,
    "Disponível?": r.d.Esgotado === "Sim" ? "Não" : "Sim", "Imagem da variação (URL)": String(r.d.Fotos || "").split(",")[0].trim(), "Código": codigoDe(r.d) }, variacaoDe(r.d)));
  return { linha, opcoes };
}

async function listar(){
  const a = await lerAbas(["Produtos", "ListasSite", "Encomendas", "Parametros", "Categorias"]);
  const produtos = [], opcoes = [], tipos = [];
  agrupar(a.Produtos).forEach((lista, id) => {
    const g = resumoDoGrupo(id, lista);
    produtos.push(g.linha);
    g.opcoes.forEach(o => { opcoes.push(o); Object.keys(o).forEach(t => { if(!NAO_E_TIPO.test(sem(t)) && !["ID do produto", "Ajuste de preço", "Disponível?", "Imagem da variação (URL)", "Código"].includes(t) && !tipos.includes(t)) tipos.push(t); }); });
  });
  const listas = a.ListasSite.map(r => r.d).filter(d => d.Tipo && d.Nome)
    .sort((x, y) => String(x.Tipo).localeCompare(y.Tipo) || (num(x.Ordem) || 999999) - (num(y.Ordem) || 999999) || String(x.Nome).localeCompare(y.Nome))
    .map(d => ({ tipo: d.Tipo, nome: d.Nome, situacao: d.Situacao || "Ativo" }));
  // categorias criadas no programa também aparecem no painel
  a.Categorias.map(r => r.d).filter(d => d.Nome && (d.Situacao || "Ativa") !== "Inativa").forEach(d => {
    if(!listas.some(x => x.tipo === "Categoria" && sem(x.nome) === sem(d.Nome))) listas.push({ tipo: "Categoria", nome: d.Nome, situacao: "Ativo" });
  });
  const encomendas = a.Encomendas.map(r => ({ r, d: r.d })).filter(x => x.d.Pedido)
    .sort((x, y) => String((x.d.Data || {})["$d"] || "").localeCompare(String((y.d.Data || {})["$d"] || "")))
    .map(({ r, d }) => ({ linha: r.id, data: dataBR(d.Data), pedido: String(d.Pedido).replace(/^#/, ""), cliente: d.Cliente || "", id: String(d.Produto || ""),
      produto: d.NomeProduto || "", qtd: Number(d.Qtd) || 1, situacao: d.Situacao || "Pendente", atualizado: d.AtualizadoEm ? dataBR(d.AtualizadoEm) : "" }));
  const zap = a.Parametros.map(r => r.d).filter(d => d.Chave === "EmpresaWhatsApp").pop();
  return { ok: true, versao: 3, banco: true, produtos, opcoes, tiposOpcao: tipos, whatsapp: { valor: zap ? String(zap.Valor || "") : "" }, listas, encomendas, planilha: null, email: auth && auth.email };
}

// ---------- fotos (Storage do Supabase, pasta pública fotos-site) ----------
async function enviarFoto(f, nome){
  if(!f) return "";
  if(typeof f === "string") return f;
  if(!f.base64) return "";
  const bin = atob(String(f.base64).replace(/^data:[^;]+;base64,/, ""));
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const arquivo = `${nome}-${Date.now().toString(36)}.jpg`;
  await req(`/storage/v1/object/${PASTA_FOTOS}/${arquivo}`, { metodo: "POST", corpo: new Blob([bytes], { type: "image/jpeg" }), cab: { "Content-Type": "image/jpeg" } })
    .catch(e => { throw /row-level|security|recusou: 4/i.test(e.message) ? erro("O banco não aceitou a foto: falta liberar a pasta de fotos no Supabase (arquivo fotos.sql).") : e; });
  return `${URL_BANCO}/storage/v1/object/public/${PASTA_FOTOS}/${arquivo}`;
}

// ---------- marcas e categorias ----------
function garantirNaLista(a, mud, tipo, nome){
  if(!nome) return;
  const x = a.ListasSite.find(r => r.d.Tipo === tipo && sem(r.d.Nome) === sem(nome));
  if(!x){
    const maior = Math.max(0, ...a.ListasSite.filter(r => r.d.Tipo === tipo).map(r => num(r.d.Ordem)));
    const novo = { id: uuid(), d: { Tipo: tipo, Nome: nome, Situacao: "Ativo", Ordem: maior + 1 } };
    a.ListasSite.push(novo); mud.push({ aba: "ListasSite", id: novo.id, dados: novo.d });
  }else if(x.d.Situacao !== "Ativo"){
    x.d = Object.assign({}, x.d, { Situacao: "Ativo" }); mud.push({ aba: "ListasSite", id: x.id, dados: x.d });
  }
  if(tipo === "Categoria" && !a.Categorias.some(r => sem(r.d.Nome) === sem(nome))){
    const c = { id: uuid(), d: { Nome: nome, MargemAtacado: null, MargemVarejo: null, Situacao: "Ativa" } };
    a.Categorias.push(c); mud.push({ aba: "Categorias", id: c.id, dados: c.d });
  }
}

// ---------- salvar produto ----------
function camposDoProduto(f, preco){
  return {
    Categoria: f.categoria, Marca: f.marca || null, Preco: preco, PrecoVarejo: preco,
    NoSite: simNao(f.noSite !== false), Destaque: simNao(f.destaque), Novo: simNao(f.novo), Oferta: simNao(f.oferta), Kit: simNao(f.kit),
    ItensKit: f.kit ? String(f.itensKit || "").split(/\r?\n/).map(x => txt(x, 120)).filter(Boolean).join("\n") : "",
    Descricao: String(f.descricao || "").trim().slice(0, 2000) || null,
    PrecoAnterior: f.oferta && num(f.precoAnterior) > 0 ? num(f.precoAnterior) : null,
  };
}
async function salvar(d){
  const f = d.produto || {};
  f.nome = txt(f.nome, 120); f.categoria = txt(f.categoria, 60); f.marca = txt(f.marca, 60);
  if(!f.nome) throw erro("Digite o nome do produto.");
  if(!f.categoria) throw erro("Digite a categoria.");
  const tipos = (Array.isArray(f.tipos) ? f.tipos : []).map(tipoPadrao).filter(t => t && !NAO_E_TIPO.test(sem(t))).slice(0, 6);
  const ops = (Array.isArray(d.opcoes) ? d.opcoes : []).map(o => ({
    valores: Object.fromEntries(tipos.map(t => [t, txt((o.valores || {})[Object.keys(o.valores || {}).find(k => sem(k) === sem(t))], 40)]).filter(([, v]) => v)),
    preco: num(o.preco), esgotado: !!o.esgotado, foto: o.foto || "" })).filter(o => Object.keys(o.valores).length);
  const preco = ops.length ? Math.min(...ops.map(o => o.preco).filter(n => n > 0)) : num(f.preco);
  if(!(preco > 0)) throw erro("Digite o preço.");
  if(f.oferta && num(f.precoAnterior) > 0 && !(num(f.precoAnterior) > preco))
    throw erro("O preço anterior precisa ser maior que o preço da oferta (R$ " + preco.toFixed(2).replace(".", ",") + ").");

  // fotos novas sobem antes (em paralelo); o produto só é gravado se todas subirem
  const idFoto = f.id || "novo";
  const fotos = await Promise.all((f.fotos || []).slice(0, 5).map((x, n) => enviarFoto(x, `${idFoto}-${n + 1}`)));
  const fotosOp = await Promise.all(ops.map((o, n) => enviarFoto(o.foto, `${idFoto}-op${n + 1}`)));

  return gravarComVersao(async () => {
    const a = await lerAbas(["Produtos", "ListasSite", "Categorias"]);
    const grupos = agrupar(a.Produtos);
    let maior = Math.max(0, ...a.Produtos.map(r => codigoDe(r.d)));
    const id = f.id ? Number(f.id) : ++maior;
    const lista = f.id ? grupos.get(id) : [];
    if(f.id && !lista) throw erro(`Não achei o produto ${f.id} no banco. Atualize a lista.`);
    const nomeAntes = lista && lista.length ? resumoDoGrupo(id, lista).linha["Produto"] : "";
    if(!f.id || sem(nomeAntes) !== sem(f.nome)){
      for(const [gid, gl] of grupos){
        if(gid === id || !gl.some(r => ativo(r.d))) continue;
        if(sem(resumoDoGrupo(gid, gl).linha["Produto"]) === sem(f.nome)) throw erro(`Já existe outro produto chamado “${f.nome}” (ID ${gid}). Use outro nome.`);
      }
    }
    const excluido = !!(lista && lista.length && !lista.some(r => ativo(r.d)));
    const usaNomeSite = !!(lista && lista.some(r => txt(r.d.NomeSite)));
    const comuns = camposDoProduto(f, preco);
    const mud = [];
    const escrever = (r, extra) => {
      const dados = Object.assign({}, r ? r.d : { EstoqueMinimo: 0, CustoInformado: null, MargemAtacado: null, MargemVarejo: null }, comuns, extra);
      if(usaNomeSite) dados.NomeSite = f.nome;
      if(excluido){ dados.Situacao = "Inativo"; dados.ExcluidoNoPainel = "Sim"; }
      else { dados.Situacao = "Ativo"; delete dados.ExcluidoNoPainel; }
      mud.push({ aba: "Produtos", id: r ? r.id : uuid(), dados });
    };
    const desligar = r => { if(ativo(r.d)) mud.push({ aba: "Produtos", id: r.id, dados: Object.assign({}, r.d, { Situacao: "Inativo" }) }); };

    if(!ops.length){
      // produto sem opções: fica um só código (o do produto); as opções antigas saem do site
      const principal = (lista || []).find(r => codigoDe(r.d) === id) || null;
      escrever(principal, { Codigo: id, Nome: f.nome, NomeBase: null, Variacao: null, Pai: null, Cor: null, Tamanho: null, Voltagem: null,
        Esgotado: simNao(f.esgotado), Fotos: fotos.filter(Boolean).join(", ") || null, FotosProduto: null });
      (lista || []).filter(r => r !== principal).forEach(desligar);
    }else{
      // cada opção casa com a variação que já tem os mesmos valores; as que mudaram reaproveitam as que sobraram
      const chave = v => tipos.map(t => sem(v[t] || "")).join("|");
      const livres = (lista || []).slice();
      const alvo = ops.map(o => { const i = livres.findIndex(r => ativo(r.d) && chave(variacaoDe(r.d)) === chave(o.valores)); return i >= 0 ? livres.splice(i, 1)[0] : null; });
      alvo.forEach((r, n) => { if(!r){ const i = livres.findIndex(x => ativo(x.d)); if(i >= 0) alvo[n] = livres.splice(i, 1)[0]; } });
      alvo.forEach((r, n) => { if(!r){ const i = livres.findIndex(x => chave(variacaoDe(x.d)) === chave(ops[n].valores)); if(i >= 0) alvo[n] = livres.splice(i, 1)[0]; } });
      // o código do produto (ID) fica sempre numa das opções, para o ID não mudar
      if(!alvo.some(r => r && codigoDe(r.d) === id)){
        const i = livres.findIndex(r => codigoDe(r.d) === id);
        const n = alvo.findIndex(r => !r || codigoDe(r.d) !== id);
        if(i >= 0){ const antigo = alvo[n]; alvo[n] = livres.splice(i, 1)[0]; if(antigo) livres.push(antigo); }
        else if(!f.id) alvo[0] = null; // produto novo: a 1ª opção recebe o código do produto
      }
      let usouId = alvo.some(r => r && codigoDe(r.d) === id);
      ops.forEach((o, n) => {
        const r = alvo[n];
        let cod = r ? codigoDe(r.d) : 0;
        if(!cod){ if(!usouId){ cod = id; usouId = true; } else cod = ++maior; }
        const vals = {}; tipos.forEach(t => { if(o.valores[t]) vals[t] = o.valores[t]; });
        escrever(r, { Codigo: cod, Pai: String(id), NomeBase: f.nome, Nome: f.nome + SEP + Object.values(vals).join(" · "), Grupo: f.nome,
          Variacao: JSON.stringify(vals), Cor: vals.Cor || null, Tamanho: vals.Tamanho || null, Voltagem: vals.Voltagem || null,
          Preco: o.preco, PrecoVarejo: o.preco, Esgotado: simNao(o.esgotado), Fotos: fotosOp[n] || null, FotosProduto: fotos.filter(Boolean).join(", ") || null });
      });
      livres.forEach(desligar);
    }
    garantirNaLista(a, mud, "Categoria", f.categoria);
    if(f.marca) garantirNaLista(a, mud, "Marca", f.marca);
    mud.push(registro(f.id ? "Alterou produto (painel do site)" : "Novo produto (painel do site)", `${id} ${f.nome}${ops.length ? ` (${ops.length} opções)` : ""}`));
    return { mudancas: mud, resposta: { ok: true, id } };
  });
}

async function mudarSituacao(id, excluir){
  return gravarComVersao(async () => {
    const a = await lerAbas(["Produtos"]);
    const lista = agrupar(a.Produtos).get(Number(id));
    if(!lista) throw erro(`Não achei o produto ${id} no banco.`);
    const mud = [];
    if(excluir){
      lista.filter(r => ativo(r.d)).forEach(r => mud.push({ aba: "Produtos", id: r.id, dados: Object.assign({}, r.d, { Situacao: "Inativo", ExcluidoNoPainel: "Sim" }) }));
    }else{
      const marcados = lista.filter(r => r.d.ExcluidoNoPainel === "Sim");
      (marcados.length ? marcados : lista).forEach(r => { const d = Object.assign({}, r.d, { Situacao: "Ativo" }); delete d.ExcluidoNoPainel; mud.push({ aba: "Produtos", id: r.id, dados: d }); });
    }
    const nome = resumoDoGrupo(Number(id), lista).linha["Produto"];
    mud.push(registro(excluir ? "Excluiu produto (painel do site)" : "Restaurou produto (painel do site)", `${id} ${nome}`));
    return { mudancas: mud, resposta: { ok: true, id: Number(id) } };
  });
}

async function salvarLoja(d){
  const zap = String(d.whatsapp || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if(!/^\d{10,11}$/.test(zap)) throw erro("WhatsApp inválido. Digite com DDD.");
  const formatado = "(" + zap.slice(0, 2) + ") " + zap.slice(2, -4) + "-" + zap.slice(-4);
  return gravarComVersao(async () => {
    const a = await lerAbas(["Parametros"]);
    const x = a.Parametros.filter(r => r.d.Chave === "EmpresaWhatsApp").pop();
    return { mudancas: [{ aba: "Parametros", id: x ? x.id : uuid(), dados: Object.assign({ Chave: "EmpresaWhatsApp", Descricao: "WhatsApp da empresa" }, x ? x.d : {}, { Valor: formatado }) },
      registro("Alterou WhatsApp (painel do site)", formatado)], resposta: { ok: true } };
  });
}

// ---------- marcas e categorias: criar, renomear, excluir, restaurar, ordenar ----------
async function mudarLista(d){
  const tipo = d.tipo === "Marca" ? "Marca" : d.tipo === "Categoria" ? "Categoria" : "";
  if(!tipo) throw erro("Tipo inválido.");
  const nome = txt(d.nome, 60), para = txt(d.para, 60);
  return gravarComVersao(async () => {
    const a = await lerAbas(["Produtos", "ListasSite", "Categorias"]);
    const mud = [];
    const deste = () => a.ListasSite.filter(r => r.d.Tipo === tipo);
    const achar = n => deste().find(r => sem(r.d.Nome) === sem(n));
    const pôr = (r, dados) => { r.d = dados; mud.push({ aba: "ListasSite", id: r.id, dados }); };
    const qual = tipo === "Marca" ? "marca" : "categoria";
    if(d.operacao === "ordenar"){
      const nomes = (Array.isArray(d.nomes) ? d.nomes : []).map(n => txt(n, 60)).filter(Boolean);
      if(!nomes.length) throw erro("Nada para ordenar.");
      const vistos = [];
      nomes.forEach(n => { if(!vistos.some(v => sem(v) === sem(n))) vistos.push(n); });
      vistos.forEach((n, i) => {
        const r = achar(n);
        if(r){ if(num(r.d.Ordem) !== i + 1) pôr(r, Object.assign({}, r.d, { Ordem: i + 1 })); }
        else { const novo = { id: uuid(), d: { Tipo: tipo, Nome: n, Situacao: "Ativo", Ordem: i + 1 } }; a.ListasSite.push(novo); mud.push({ aba: "ListasSite", id: novo.id, dados: novo.d }); }
      });
      let k = vistos.length;
      deste().filter(r => !vistos.some(v => sem(v) === sem(r.d.Nome))).forEach(r => { k++; if(num(r.d.Ordem) !== k) pôr(r, Object.assign({}, r.d, { Ordem: k })); });
      mud.push(registro(`Ordenou ${tipo === "Marca" ? "marcas" : "categorias"} (painel do site)`, vistos.join(", ")));
      return { mudancas: mud, resposta: { ok: true } };
    }
    if(!nome) throw erro("Digite o nome.");
    const x = achar(nome);
    // troca Marca/Categoria nos produtos (todas as variações, ativas ou não)
    const trocar = (de, novo) => {
      let n = 0; const grupos = new Set();
      a.Produtos.forEach(r => {
        if(!ehLoja(r.d) || sem(r.d[tipo]) !== sem(de)) return;
        mud.push({ aba: "Produtos", id: r.id, dados: Object.assign({}, r.d, { [tipo]: novo || null }) });
        const g = paiDe(r.d) || codigoDe(r.d); if(!grupos.has(g)){ grupos.add(g); n++; }
      });
      return n;
    };
    if(d.operacao === "criar" || d.operacao === "restaurar"){
      if(x && x.d.Situacao === "Ativo" && d.operacao === "criar") throw erro(`${tipo} “${x.d.Nome}” já existe.`);
      garantirNaLista(a, mud, tipo, x ? x.d.Nome : nome);
      mud.push(registro((d.operacao === "criar" ? "Nova " : "Restaurou ") + qual + " (painel do site)", x ? x.d.Nome : nome));
      return { mudancas: mud, resposta: { ok: true } };
    }
    if(d.operacao === "renomear"){
      if(!para) throw erro("Digite o nome novo.");
      const n = trocar(nome, para);
      const destino = achar(para);
      if(x && (!destino || destino === x)) pôr(x, Object.assign({}, x.d, { Nome: para, Situacao: "Ativo" }));
      else { if(x) pôr(x, Object.assign({}, x.d, { Situacao: "Excluído" })); garantirNaLista(a, mud, tipo, para); }
      if(tipo === "Categoria"){
        const c = a.Categorias.find(r => sem(r.d.Nome) === sem(nome));
        if(c && !a.Categorias.some(r => r !== c && sem(r.d.Nome) === sem(para))) mud.push({ aba: "Categorias", id: c.id, dados: Object.assign({}, c.d, { Nome: para }) });
        else garantirNaLista(a, mud, tipo, para);
      }
      mud.push(registro("Renomeou " + qual + " (painel do site)", `${nome} → ${para} (${n} produtos)`));
      return { mudancas: mud, resposta: { ok: true, produtos: n } };
    }
    if(d.operacao === "excluir"){
      const grupos = agrupar(a.Produtos);
      let usados = 0;
      grupos.forEach(l => { const r = l.find(y => ativo(y.d)); if(r && sem(r.d[tipo]) === sem(nome)) usados++; });
      const semMarca = tipo === "Marca" && d.semMarca === true;
      if(usados && !para && !semMarca) throw erro(`Há ${usados} produto(s) com ${qual} “${nome}”. Escolha para onde mover antes de excluir.`);
      const n = para || semMarca ? trocar(nome, para) : 0;
      if(para) garantirNaLista(a, mud, tipo, para);
      if(x) pôr(x, Object.assign({}, x.d, { Situacao: "Excluído" }));
      else { const novo = { id: uuid(), d: { Tipo: tipo, Nome: nome, Situacao: "Excluído", Ordem: 999 } }; mud.push({ aba: "ListasSite", id: novo.id, dados: novo.d }); }
      mud.push(registro("Excluiu " + qual + " (painel do site)", nome + (para ? ` (produtos foram para ${para})` : semMarca && n ? ` (${n} produtos ficaram sem marca)` : "")));
      return { mudancas: mud, resposta: { ok: true, produtos: n } };
    }
    throw erro("Operação desconhecida.");
  });
}

const SITUACOES_ENCOMENDA = ["Pendente", "Encomendado", "Não vai encomendar"];
async function mudarSituacaoEncomenda(d){
  const situacao = SITUACOES_ENCOMENDA.find(x => sem(x) === sem(d.situacao));
  if(!situacao) throw erro("Situação inválida.");
  const alvos = Array.isArray(d.itens) ? d.itens : [];
  return gravarComVersao(async () => {
    const a = await lerAbas(["Encomendas"]);
    const mud = [];
    alvos.forEach(x => {
      const r = a.Encomendas.find(y => y.id === String(x.linha));
      if(r) mud.push({ aba: "Encomendas", id: r.id, dados: Object.assign({}, r.d, { Situacao: situacao, AtualizadoEm: agoraLocal() }) });
    });
    if(!mud.length) throw erro("Não achei essas encomendas. Atualize a lista.");
    mud.push(registro("Encomenda: " + situacao + " (painel do site)", `${mud.length} item(ns)`));
    return { mudancas: mud, resposta: { ok: true, alterados: mud.length - 1 } };
  });
}

// ---------- importar da planilha (uma vez, ao trocar para o banco) ----------
function lerCSV(texto){
  const linhas = []; let linha = [], campo = "", aspas = false;
  for(let i = 0; i < texto.length; i++){
    const c = texto[i];
    if(aspas){ if(c === '"'){ if(texto[i + 1] === '"'){ campo += '"'; i++; } else aspas = false; } else campo += c; }
    else if(c === '"') aspas = true;
    else if(c === ","){ linha.push(campo); campo = ""; }
    else if(c === "\n" || c === "\r"){ if(c === "\r" && texto[i + 1] === "\n") i++; linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if(campo || linha.length){ linha.push(campo); linhas.push(linha); }
  return linhas;
}
function tabelaCSV(texto, chave){
  const l = lerCSV(texto);
  const i = l.findIndex(x => x.some(c => sem(c) === chave));
  if(i < 0) return { topo: l, cab: [], linhas: [] };
  const cab = l[i].map(c => String(c).trim());
  return { topo: l.slice(0, i), cab, linhas: l.slice(i + 1).map(x => Object.fromEntries(cab.map((c, k) => [c, x[k] ?? ""]))) };
}
const col = (o, ...nomes) => { for(const n of nomes){ const k = Object.keys(o).find(c => sem(c) === sem(n)); if(k !== undefined && String(o[k]).trim() !== "") return String(o[k]).trim(); } return ""; };
const precoBR = v => { const t = String(v ?? "").replace(/R\$\s*/i, "").replace(/[^\d,.-]/g, ""); if(!t) return 0; return num(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); };

async function importarPlanilha({ urlScript, senhaAntiga }, avisar){
  avisar = avisar || (() => {});
  const pegar = async q => { const r = await buscar(`${urlScript}?csv=${q}&t=${Date.now()}`, { cache: "no-store" }); if(!r.ok) throw erro("A planilha não respondeu (" + q + ")."); return r.text(); };
  avisar("Lendo a planilha...");
  const [tp, to, tl] = await Promise.all([pegar("produtos"), pegar("opcoes"), pegar("listas").catch(() => "")]);
  const P = tabelaCSV(tp, "id"), O = tabelaCSV(to, "id do produto"), L = lerCSV(tl || "");
  const produtosPlanilha = P.linhas.filter(l => /^\d+$/.test(col(l, "ID")));
  if(!produtosPlanilha.length) throw erro("Não achei produtos na planilha.");
  const tiposCols = O.cab.filter(c => c && !NAO_E_TIPO.test(sem(c)));
  const opsPor = {};
  O.linhas.forEach(l => { const id = col(l, "ID do produto"); if(/^\d+$/.test(id)) (opsPor[id] = opsPor[id] || []).push(l); });
  let zap = "";
  P.topo.forEach(l => { const k = l.findIndex(c => sem(c).startsWith("whatsapp")); if(k >= 0 && !zap) zap = String(l[k + 1] || "").trim(); });

  // encomendas: só com a senha antiga do painel (a lista delas não é pública)
  let encomendasAntigas = [];
  if(senhaAntiga){
    avisar("Buscando as encomendas da planilha...");
    const post = async corpo => { const r = await buscar(urlScript, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(corpo) }); return r.json(); };
    const e = await post({ acao: "entrar", senha: senhaAntiga });
    if(!e.ok || !e.token) throw erro("A senha antiga do painel não confere. Deixe em branco para importar sem as encomendas.");
    const lst = e.dados && e.dados.encomendas ? e.dados : await post({ acao: "listar", token: e.token });
    encomendasAntigas = Array.isArray(lst.encomendas) ? lst.encomendas : [];
    post({ acao: "sair", token: e.token }).catch(() => {});
  }

  avisar(`Gravando ${produtosPlanilha.length} produtos no banco...`);
  return gravarComVersao(async () => {
    const a = await lerAbas(["Produtos", "ListasSite", "Categorias", "Encomendas", "Parametros"]);
    const mud = [];
    const ocupados = new Map(a.Produtos.map(r => [codigoDe(r.d), r]));
    let maior = Math.max(0, ...a.Produtos.map(r => codigoDe(r.d)), ...produtosPlanilha.map(l => Number(col(l, "ID"))));
    const novoId = {}; // ID da planilha -> código no banco
    let qtdOps = 0;
    produtosPlanilha.forEach(l => {
      const idPl = Number(col(l, "ID"));
      // já importado antes: atualiza o mesmo produto. Código usado por outro produto do programa: ganha código novo.
      const ja = a.Produtos.find(r => r.d.ImportadoDaPlanilha === idPl && (paiDe(r.d) === codigoDe(r.d) || !paiDe(r.d)));
      const id = ja ? codigoDe(ja.d) : ocupados.has(idPl) ? ++maior : idPl;
      novoId[idPl] = id;
      const sit = sem(col(l, "Situação", "Situacao"));
      const excluido = sit.startsWith("exclu");
      const preco = precoBR(col(l, "Preço (R$)", "Preço", "Preco"));
      const fotos = COLS_FOTO.map((c, n) => col(l, c, n === 0 ? "Imagem" : c)).filter(Boolean);
      const nome = txt(col(l, "Produto", "Nome"), 120);
      if(!nome) return;
      const comuns = {
        Nome: nome, Categoria: txt(col(l, "Categoria"), 60) || "Outros", Marca: txt(col(l, "Marca"), 60) || null,
        NoSite: simNao(!sit.startsWith("fora")), Destaque: simNao(ehSim(col(l, "Recomendado?", "Recomendado"))), Novo: simNao(ehSim(col(l, "Novo?", "Novo"))),
        Oferta: simNao(ehSim(col(l, "Oferta Especial?", "Oferta especial"))), Kit: simNao(ehSim(col(l, "É Kit?", "Kit?", "Kit"))),
        ItensKit: col(l, "Itens do Kit"), Descricao: col(l, "Descrição", "Descricao") || null,
        PrecoAnterior: precoBR(col(l, "Preço anterior (R$)", "Preço anterior")) || null,
        Situacao: excluido ? "Inativo" : "Ativo", ImportadoDaPlanilha: idPl, EstoqueMinimo: 0,
      };
      if(excluido) comuns.ExcluidoNoPainel = "Sim";
      const antigos = a.Produtos.filter(r => r.d.ImportadoDaPlanilha === idPl);
      const pega = cod => antigos.find(r => codigoDe(r.d) === cod);
      const ops = (opsPor[idPl] || []).map(o => {
        const vals = {}; tiposCols.forEach(t => { const v = txt(o[t], 40); if(v) vals[tipoPadrao(t)] = v; });
        return { vals, ajuste: precoBR(col(o, "Ajuste de preço", "Ajuste")), esgotado: /^n[aã]o$/i.test(col(o, "Disponível?", "Disponivel")), foto: col(o, "Imagem da variação (URL)", "Imagem") };
      }).filter(o => Object.keys(o.vals).length);
      if(!ops.length){
        const r = pega(id);
        mud.push({ aba: "Produtos", id: r ? r.id : uuid(), dados: Object.assign({}, r ? r.d : {}, comuns, { Codigo: id, Preco: preco, PrecoVarejo: preco,
          Esgotado: simNao(sit.startsWith("esgot")), Fotos: fotos.join(", ") || null, Pai: null, NomeBase: null, Variacao: null }) });
        return;
      }
      const usados = new Set();
      ops.forEach((o, n) => {
        const chave = JSON.stringify(o.vals);
        let r = antigos.find(x => !usados.has(x) && JSON.stringify(variacaoDe(x.d)) === chave);
        if(r) usados.add(r);
        const cod = r ? codigoDe(r.d) : n === 0 && !pega(id) ? id : ++maior;
        const p = num(preco + o.ajuste);
        qtdOps++;
        mud.push({ aba: "Produtos", id: r ? r.id : uuid(), dados: Object.assign({}, r ? r.d : {}, comuns, { Codigo: cod, Pai: String(id), NomeBase: nome, Grupo: nome,
          Nome: nome + SEP + Object.values(o.vals).join(" · "), Variacao: JSON.stringify(o.vals), Cor: o.vals.Cor || null, Tamanho: o.vals.Tamanho || null, Voltagem: o.vals.Voltagem || null,
          Preco: p, PrecoVarejo: p, Esgotado: simNao(o.esgotado || sit.startsWith("esgot")), Fotos: o.foto || null, FotosProduto: fotos.join(", ") || null }) });
      });
    });
    // marcas e categorias, na ordem da planilha
    const ordem = { Marca: 0, Categoria: 0 };
    L.slice(1).forEach(l => {
      const tipo = sem(l[0]) === "marca" ? "Marca" : sem(l[0]) === "categoria" ? "Categoria" : "";
      const nome = txt(l[1], 60);
      if(!tipo || !nome) return;
      const sit = sem(l[2]).startsWith("exclu") ? "Excluído" : "Ativo";
      const x = a.ListasSite.find(r => r.d.Tipo === tipo && sem(r.d.Nome) === sem(nome));
      const dados = { Tipo: tipo, Nome: x ? x.d.Nome : nome, Situacao: sit, Ordem: ++ordem[tipo] };
      if(x){ x.d = dados; mud.push({ aba: "ListasSite", id: x.id, dados }); }
      else { const novo = { id: uuid(), d: dados }; a.ListasSite.push(novo); mud.push({ aba: "ListasSite", id: novo.id, dados }); }
    });
    const cats = new Set(), marcas = new Set();
    produtosPlanilha.forEach(l => { const c = txt(col(l, "Categoria"), 60); if(c) cats.add(c); const m = txt(col(l, "Marca"), 60); if(m) marcas.add(m); });
    cats.forEach(c => { if(!a.ListasSite.some(r => r.d.Tipo === "Categoria" && sem(r.d.Nome) === sem(c))) garantirNaLista(a, mud, "Categoria", c);
      else if(!a.Categorias.some(r => sem(r.d.Nome) === sem(c))) { const x = { id: uuid(), d: { Nome: c, MargemAtacado: null, MargemVarejo: null, Situacao: "Ativa" } }; a.Categorias.push(x); mud.push({ aba: "Categorias", id: x.id, dados: x.d }); } });
    marcas.forEach(m => { if(!a.ListasSite.some(r => r.d.Tipo === "Marca" && sem(r.d.Nome) === sem(m))) garantirNaLista(a, mud, "Marca", m); });
    // encomendas antigas (sem repetir as que já vieram)
    let qtdEnc = 0;
    encomendasAntigas.forEach(e => {
      const pedido = String(e.pedido || "").replace(/\D/g, ""), idPl = Number(e.id);
      if(!pedido) return;
      if(a.Encomendas.some(r => r.d.Pedido === pedido && String(r.d.Produto) === String(novoId[idPl] || idPl) && (r.d.Cliente || "") === (e.cliente || ""))) return;
      qtdEnc++;
      mud.push({ aba: "Encomendas", id: uuid(), dados: { Data: dataDoBR(e.data), Pedido: pedido, Cliente: e.cliente || "", Produto: novoId[idPl] || idPl, NomeProduto: e.produto || "",
        Qtd: Number(e.qtd) || 1, Situacao: SITUACOES_ENCOMENDA.includes(e.situacao) ? e.situacao : "Pendente", AtualizadoEm: e.atualizado ? dataDoBR(e.atualizado) : null } });
    });
    const zapLimpo = zap.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if(/^\d{10,11}$/.test(zapLimpo)){
      const x = a.Parametros.filter(r => r.d.Chave === "EmpresaWhatsApp").pop();
      const formatado = "(" + zapLimpo.slice(0, 2) + ") " + zapLimpo.slice(2, -4) + "-" + zapLimpo.slice(-4);
      mud.push({ aba: "Parametros", id: x ? x.id : uuid(), dados: Object.assign({ Chave: "EmpresaWhatsApp", Descricao: "WhatsApp da empresa" }, x ? x.d : {}, { Valor: formatado }) });
    }
    const trocados = Object.entries(novoId).filter(([a1, b1]) => Number(a1) !== b1);
    mud.push(registro("Importou a planilha (painel do site)", `${produtosPlanilha.length} produtos, ${qtdOps} opções, ${qtdEnc} encomendas`));
    return { mudancas: mud, resposta: { ok: true, produtos: produtosPlanilha.length, opcoes: qtdOps, encomendas: qtdEnc, codigosTrocados: trocados } };
  });
}

// ---------- esqueci a senha (mesmo jeito do programa: código do e-mail ou o link copiado) ----------
async function esqueciSenha(email){
  email = txt(email, 200).toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro("Digite o e-mail da conta.");
  const r = await buscar(`${URL_BANCO}/auth/v1/recover`, { method: "POST", headers: { apikey: CHAVE, "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  if(!r.ok && r.status !== 429) throw erro("Não consegui mandar o e-mail agora. Tente de novo em alguns minutos.");
  if(r.status === 429) throw erro("Já mandamos um e-mail há pouco. Espere 1 minuto e tente de novo.");
  return { ok: true };
}
async function novaSenha(email, codigo, nova){
  email = txt(email, 200).toLowerCase(); codigo = String(codigo || "").trim();
  if(!codigo) throw erro("Cole o código ou o link do e-mail.");
  if(String(nova || "").length < 6) throw erro("A senha nova precisa ter pelo menos 6 caracteres.");
  let corpo;
  const m = codigo.match(/[?&]token=([^&\s]+)/);
  if(m) corpo = { type: "recovery", token_hash: decodeURIComponent(m[1]) };
  else corpo = { type: "recovery", email, token: codigo.replace(/\s/g, "") };
  const r = await buscar(`${URL_BANCO}/auth/v1/verify`, { method: "POST", headers: { apikey: CHAVE, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  if(!r.ok || !d.access_token) throw erro("Código ou link inválido ou vencido. Peça outro e-mail.");
  guardar({ access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + (d.expires_in || 3600) * 1000, email: (d.user && d.user.email) || email });
  await req("/auth/v1/user", { metodo: "PUT", corpo: { password: nova } });
  if(!(await rpc("e_membro"))){ guardar(null); throw erro("Senha trocada, mas esta conta ainda não foi aprovada no programa do Studio.", "senha"); }
  return { ok: true, token: "banco" };
}
window.bancoEsqueciSenha = esqueciSenha;
window.bancoNovaSenha = novaSenha;

// ---------- entrada única usada pelo painel ----------
async function chamarBanco(d){
  if(d.acao === "entrar"){
    const email = txt(d.email, 200).toLowerCase();
    if(!email || !d.senha) throw erro("Digite o e-mail e a senha.", "senha");
    guardar(await pedirAuth("token?grant_type=password", { email, password: d.senha }));
    if(!(await rpc("e_membro"))){ guardar(null); throw erro("Esta conta ainda não foi aprovada no programa do Studio (o Admin aprova em Usuários).", "senha"); }
    return { ok: true, token: "banco", dados: await listar() };
  }
  if(d.acao === "sair"){ guardar(null); return { ok: true }; }
  if(d.acao === "listar") return listar();
  if(d.acao === "salvar") return salvar(d);
  if(d.acao === "excluir" || d.acao === "restaurar") return mudarSituacao(d.id, d.acao === "excluir");
  if(d.acao === "loja") return salvarLoja(d);
  if(d.acao === "lista") return mudarLista(d);
  if(d.acao === "situacaoEncomenda") return mudarSituacaoEncomenda(d);
  throw erro("Ação desconhecida.");
}
window.chamarBanco = chamarBanco;
window.importarPlanilhaParaBanco = importarPlanilha;
window.bancoLogado = () => !!(lerGuardado() && auth.refresh_token);
window.bancoEmail = () => (lerGuardado() && auth.email) || "";
})();
