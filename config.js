// Configuração do Studio Renata Almeida, usada pelo site (index.html) e pelo painel (admin.html).
// Banco do Studio (Supabase), o mesmo do programa. A chave é a pública ("publishable"): ela só deixa
// ler o catálogo e entrar com e-mail e senha; quem grava é conferido no próprio banco.
// Nunca coloque aqui a chave "secret" / "service_role".
window.STUDIO_CONFIG = {
  supabaseUrl: "https://nvhvrwyarphfccrbbzvh.supabase.co",
  supabaseChave: "sb_publishable_eHT_maEHCu8fJGughTJHEg_MZjTodli",
};
