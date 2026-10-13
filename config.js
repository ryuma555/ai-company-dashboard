// 公開してよい設定だけを置く。
// publishableKey は「公開用の鍵」で、ブラウザに置く前提のもの（データはログイン＋データベースの許可で守られている）。
// service_role など、強い権限の鍵は絶対にここに書かない。
window.DASHBOARD_CONFIG = {
  supabaseUrl: "https://frvxplzrmuydrxzqmayh.supabase.co",
  publishableKey: "sb_publishable_mZsxld4FYWIUz_jzW5NaUQ_31jCeepB",
};
