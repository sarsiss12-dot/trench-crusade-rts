export const TR_P5C = {
  'hud.econ.hunting': 'YEŞİL: Av habitatı · KIRMIZI: Tehlikeli habitat · MOR: Veba kaynağı · Ceset / hayvan: biyokütle · Açık halka: teslim',
  'hud.econ.sectors': 'Kaynak sektörleri: tarım, mera, taş, hurda, depo ve yerleşimler',
  'hud.econ.nodes': 'TURKUAZ: Tahkimat erişimi · SARI: İkmal düğümü · Hurda: malzeme',
  'lens.src.habitat': 'Güvenli av habitatı',
  'hud.autohunt_on': 'Oto Av ✓', 'hud.autohunt_off': 'Oto Av',
  'hud.autohunt_tip': 'Kalıcı OTO AV: görülen avı veya keşfedilmiş habitatı bul, avla, taşı, teslim et ve tekrarla.',
  'hud.safehunt_on': 'Güvenli Av ✓', 'hud.safehunt_off': 'Güvenli Av',
  'hud.safehunt_tip': 'Ayrı risk ayarı: bilinen düşman ve silah menzilinden uzak dur; tehditte geri dön.',
  'garrison.contested': 'ÇATIŞMALI — bina hücumu',
  'lens.habitat': 'Av habitatı', 'lens.dropoff': 'Biyokütle teslim noktası', 'lens.plague': 'Veba kaynağı',
  'lens.infection': 'Enfekte zemin', 'lens.fortification': 'Savunma düğümü',
  'unit.autonomous_risen': 'Bağımsız Dirilenler', 'unit.autonomous_risen.desc': 'Salgının kendi savaşan sürüsü; doğrudan kontrol edilemez.',
};
export const EN_P5C = {
  'hud.econ.hunting': 'GREEN: Hunting habitat · RED: Threatened habitat · PURPLE: Plague source · Corpses / animals: biomass · Pale ring: drop-off',
  'hud.econ.sectors': 'Resource sectors: crops, pasture, quarry, scrap, depots and settlements',
  'hud.econ.nodes': 'CYAN: Fortification reach · YELLOW: Supply nodes · Scrap: material',
  'lens.src.habitat': 'Safe hunting habitat',
  'hud.autohunt_on': 'Auto Hunt ✓', 'hud.autohunt_off': 'Auto Hunt',
  'hud.autohunt_tip': 'Persistent AUTO HUNT: find visible prey or explored habitat, hunt, harvest, deliver and repeat.',
  'hud.safehunt_on': 'Safe Hunt ✓', 'hud.safehunt_off': 'Safe Hunt',
  'hud.safehunt_tip': 'Separate risk setting: avoid known enemies and weapon coverage; withdraw from threats.',
  'garrison.contested': 'CONTESTED — storming building',
  'lens.habitat': 'Hunting habitat', 'lens.dropoff': 'Biomass drop-off', 'lens.plague': 'Plague source',
  'lens.infection': 'Infected ground', 'lens.fortification': 'Defensive node',
  'unit.autonomous_risen': 'Autonomous Risen', 'unit.autonomous_risen.desc': 'The plague fights for itself. Cannot be directly controlled.',
};
const BUILDINGS = [
  ['sultanate_muster', 'Sultanlık Toplanma Ocağı', 'Sultanate Muster', 'Azeb/Janissary üretimi ve takviye.', 'Azeb/Janissary training and reinforcement.'],
  ['sultanate_supply', 'Güvenli İkmal Düğümü', 'Secured Supply Node', 'Güvenliyken ikmal ve insan gücü. Cephane ve hurda teslimi.', 'Supply and manpower while secure. Ammunition and salvage drop-off.'],
  ['sultanate_arsenal', 'Saha Onarım Ocağı', 'Field Repair Arsenal', 'Yakındaki yapıları malzeme karşılığı onarır; ikmal ve takviye.', 'Repairs nearby structures using material; resupply and reinforcement.'],
  ['jabirean_laboratory', 'Cabirî Saha Laboratuvarı', 'Jabirean Field Laboratory', 'Simyager üretir; yakındaki zemin enfeksiyonunu temizler.', 'Trains Alchemists; cleanses nearby ground infection.'],
  ['sultanate_fieldworks', 'Hafif Saha Mevzisi', 'Light Fieldworks', 'Ucuz ve hızlı yönlü piyade siperi.', 'Cheap, fast directional infantry cover.'],
  ['sultanate_battery', 'Sultanlık Destek Bataryası', 'Sultanate Support Battery', 'Sınırlı yaylı, mühimmat tüketen topçu mevzii.', 'Ammunition-consuming artillery with a limited firing arc.'],
];
for (const [id, tr, en, td, ed] of BUILDINGS) {
  TR_P5C['struct.' + id] = tr; EN_P5C['struct.' + id] = en;
  TR_P5C['struct.' + id + '.desc'] = td; EN_P5C['struct.' + id + '.desc'] = ed;
}
const SPECS = [
  ['is_engineering', 'İstihkâm Okulu', 'Engineering School', 'Onarım ×1,5; inşa ×1,2|Onarım Ocağı|AI: Sapper, tahkimat ve yedek', 'Repair ×1.5; build ×1.2|Repair Arsenal|AI: Sappers, fortifications and reserve'],
  ['is_discipline', 'Disiplinli Hat', 'Disciplined Line', 'Janissary eğitim süresi %20, maliyeti %10 düşük|AI: daha çok Janissary ve yedek', 'Janissary training time −20%, cost −10%|AI: more Janissaries and reserve'],
  ['is_alchemy', 'Simyasal Destek', 'Alchemical Support', 'Simyager maliyeti %20 düşük; temizlik ×1,5|Laboratuvar|AI: destek ve veba karşıtı öncelik', 'Alchemist cost −20%; sanitation ×1.5|Laboratory|AI: support and anti-plague priority'],
  ['is_layered_defense', 'Katmanlı Savunma', 'Layered Defense', 'Onarım ×1,3; Destek Bataryası|AI: savunma bütçesi ve yedek', 'Repair ×1.3; Support Battery|AI: defense budget and reserve'],
  ['is_counterguard', 'Karşı Taarruz Muhafızı', 'Counterguard', 'Takviye aralığı %30 kısa|AI: elitler ve kontrollü karşı taarruz', 'Reinforcement interval −30%|AI: elites and controlled counterattacks'],
  ['is_fire_cordon', 'Ateş Kordonu', 'Fire Cordon', 'Temizlik ×1,5; Simyager eğitim süresi %25 kısa|Laboratuvar ve Batarya|AI: alan kontrolü ve destek', 'Sanitation ×1.5; Alchemist training time −25%|Laboratory and Battery|AI: area control and support'],
  ['is_preservation', 'Tahkimatı Koru', 'Preserve the Works', 'Onarım ×1,5; takviye ikmali %30 düşük|Onarım Ocağı|AI: Sapper, onarım ve güçlü yedek', 'Repair ×1.5; reinforcement supply −30%|Repair Arsenal|AI: Sappers, repairs and strong reserve'],
  ['is_measured_advance', 'Ölçülü İlerleme', 'Measured Advance', 'Janissary maliyet ve eğitim süresi %15 düşük|AI: büyük dalga ve ileri düğümler', 'Janissary cost and training time −15%|AI: larger waves and forward nodes'],
  ['is_purifying_fire', 'Arındırıcı Ateş', 'Purifying Fire', 'Enfeksiyon alımı %30 düşük; temizlik ×2|Laboratuvar|AI: yoğun destek ve temizlik', 'Infection intake −30%; sanitation ×2|Laboratory|AI: concentrated support and sanitation'],
];
for (const [id, tr, en, td, ed] of SPECS) {
  TR_P5C['spec.' + id] = tr; EN_P5C['spec.' + id] = en;
  TR_P5C['spec.' + id + '.p'] = td; EN_P5C['spec.' + id + '.p'] = ed;
  TR_P5C['spec.' + id + '.theme'] = 'RTS doktrini — gameplay abstraction';
  EN_P5C['spec.' + id + '.theme'] = 'RTS doctrine — gameplay abstraction';
}
