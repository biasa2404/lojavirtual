// Configuração do Studio Renata Almeida, usada pelo site (index.html) e pelo painel (admin.html).
// Os dois valores vêm do Supabase › Project Settings › API. A chave é a pública
// ("publishable"): ela só deixa ler o catálogo e entrar com e-mail e senha.
// Nunca coloque aqui a chave "secret" / "service_role".
window.STUDIO_CONFIG = {
  supabaseUrl: "https://nvhvrwyarphfccrbbzvh.supabase.co",
  supabaseChave: "sb_publishable_eHT_maEHCu8fJGughTJHEg_MZjTodli",
  // false: o site continua lendo a planilha. Para testar o catálogo do programa sem mudar o site
  // de todo mundo, abra o site com ?programa=1 no fim do link. Quando o programa estiver pronto, mude para true.
  usarPrograma: false,
};
