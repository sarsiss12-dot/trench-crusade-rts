# Mimari — Fraksiyon / Taraf / Rol / Senaryo / Harita (Faz 05A)

Faz 05A'nın tek amacı, "Yeni Antakya = savunan, Kara Kâse = saldıran" varsayımını çekirdekten sökmekti.
Yeni fraksiyon **eklenmedi**. Bu belge, kodun bugün kullandığı beş kavramı ve aralarındaki sınırı tanımlar.

| Kavram | Tanım | Kodda |
|---|---|---|
| **FACTION** | **Kim olduğun.** Birimler, yapılar, kaynaklar, ekonomi, seçkinler, uzmanlıklar, görsel/işitsel kimlik, AI doktrini. | `src/data/factions.js` (`FACTIONS`), `src/factions/*.js`, `src/ai/<faction>_ai.js` |
| **SIDE** | **Maçta hangi oyuncu/takım olduğun.** Sahip olunan her şey (manga, yapı, kaynak, sis katmanı, Salgın ölçeği, AI hafızası) taraf kimliğiyle anahtarlanır. | `state.sides`, `state.factions[sideId]`, `src/sim/sides.js` |
| **ROLE** | **Maça hangi stratejik konumda başladığın** (`attacker` / `defender`). Yalnızca başlangıç bölgesi, başlangıç paketi, hedef ilişkisi ve AI'ın başlangıç eğilimini seçer. | `state.sides[i].role`, `src/data/packages.js`, `src/data/ai.js` (`STRATEGY`) |
| **SCENARIO** | **Haritanın kuralları ve hedefleri.** Rol → bölge, hedefler (rol ile), zafer kuralı, süreler, kurulum modları, lore ön ayarı, senaryo özellikleri, hava. | `src/data/scenarios.js` |
| **MAP** | **Fiziksel savaş alanı.** Arazi, nehir, köprüler, harabeler, sektörler, yaban hayatı, bölgeler (`regions`), şeritler, doktrin planları. | `src/data/maps.js`, `src/world/*` |

## 1. Taraf kimliği (SIDE id)

- Bir fraksiyonun maçtaki **ilk** tarafının kimliği fraksiyon kimliğinin kendisidir (`new_antioch`, `black_grail`).
  Ayna maçta ikinci taraf `"<faction>~2"` olur (`new_antioch~2`). Böylece klasik maçın tüm kayıt/test
  verisi aynı kalır, ayna maç da gerçek iki ayrı taraf olur.
- `baseFaction(id)` → içerik fraksiyonu (saf, önbellekli). `sideDef(id)` → fraksiyon tanımı.
- `areHostile(a, b)` → **taraf** farklıysa düşman (nötr hiç kimsenin düşmanı değil). Ayna maçta iki taraf düşmandır.
- `sideIndex(id)` / `sideBit(id)` → sis/görüş katmanı. İlk taraf fraksiyonun indeksini alır; ikiz, fraksiyonun
  kullanmadığı en düşük katmanı alır. `FOG_LAYERS = 2` (iki taraflı maç). Saf fonksiyon → kayıt/yükleme güvenli.
- `contentIndex(id)` → içerik indeksi (ör. navigasyondaki fraksiyona özgü arazi hızı tabloları).

`state.factions` anahtar adı kayıt uyumluluğu için korundu; **taraf** başına durumdur ve şunları da taşır:
`faction`, `role`, `region`, `zone` (inşa/konuşlanma bölgesi, bölge verisinden kopya), `popStart`.

## 2. Senaryo sözleşmesi

```js
siege_default: {
  mode: 'siege', map: 'antioch_outskirts',
  setupModes: ['lore', 'free'],
  lore: { defender: 'new_antioch', attacker: 'black_grail' },   // Lore Setup ön ayarı (tek olası savaş değil)
  slots: ['defender', 'attacker'],                               // taraf oluşturma sırası (deterministik)
  roles: { defender: { region: 'south' }, attacker: { region: 'north' } },
  objectives: [{ id: 'defenderPrimaryObjective', type: 'primary_hq', owner: 'defender' }],
  victory: 'siege', durations: 'all', features: [], weather: {...},
}
```

Senaryo **hiçbir yerde fraksiyon adı** ile hedef, kaynak veya birlik tanımlamaz; hepsi rol ile anahtarlanır.
`features` senaryo özelliği içindir (ileride ör. Iron Wall) — **fraksiyon özelliği değildir**; Faz 05A'da boştur.
`open_battle` (ikincil) aynı haritada kale olmadan **imha** kuralıyla oynanır.

## 3. Başlangıç paketleri

`PACKAGES[faction][role]` = kaynaklar + nüfus + yapılar + kuvvetler. Paket bir bölge için yazılır (`authored`)
ve taraf öbür bölgedeyse harita merkezine göre **nokta yansıtılır** (`sides.js placeInRegion`: `(x,z)→(W−x,H−z)`,
`rot+π`). `primary: true` tarafın birincil karargâhını işaretler; senaryonun `primary_hq` hedefi hangi role
aitse o tarafın birincil karargâhı hedef olur — fraksiyonu ne olursa olsun.

| Paket | İçerik (kimlik korunur) |
|---|---|
| Yeni Antakya savunan | Kilise Burcu (birincil), ikmal deposu, 2 tarla, 3 siper, 6 piyade + 2 istihkâm + 1 ağır |
| Yeni Antakya saldıran | **Sahra Karargâhı** (oyun soyutlaması), ikmal deposu, 1 tarla, 2 siper, aynı kuvvet, daha az nüfus |
| Kara Kâse saldıran | 3 sunak, ön ceset höyüğü, sürü (klasik başlangıç) |
| Kara Kâse savunan | 3 sunak (birincil ortada), höyük, iç organ yuvası, evin önünde sürü |

## 4. Bölgeler, planlar, şeritler

- `map.regions.south|north`: `facing` (düşmana bakış), `zone`, genel çapalar (`line`, `base`, `reserve`, `mass`,
  `support`, `elite`, `home`). Fraksiyon adlı çapa (`na_line`, `home_bg`…) kalmadı.
- Doktrin planları (`fortifyPlan` güney için, `organicPlan` kuzey için yazıldı) `planFor(sim, side, kind)` ile
  tarafın bölgesine taşınır. Saldırı şeritleri kuzeyden güneye yazılır; güneydeki taraf için yansıtılır
  (`lanesFor`).
- Kamera, HOME odağı, yerleştirme yönü ve hat önü (`chooseFront`) bölge `facing`'inden gelir.

## 5. Zafer

`state.match.victory` (senaryodan) ve `state.objectives` (`{ id, type, structureId, side, role }`):

- **SIEGE:** hedef yıkılırsa hedef sahibinin düşmanı kazanır; süre dolar ve hedef ayaktaysa sahibi kazanır
  (süresiz savaşta asla); saldıran tükenirse savunan kazanır.
- **İMHA (her iki modda):** HQ yeteneği olan yapısı (`STRUCTURES[type].hq`, isim değil) ve anlamlı savaşan gücü
  (combatUnit mangası) kalmayan taraf kaybeder → savunan karşı saldırıyla saldıranın üssünü yakıp kazanabilir.
- `open_battle`: süre dolunca sahada güçlü kalan kazanır (eşitse berabere); süresizde yalnız imha.

## 6. Veba sahipliği (taraf başına)

- `pestGain/pestLoss/pestTier…(…, side)`: her Salgın ölçeği bir tarafındır.
- Enfeksiyon yığını onu bırakan tarafı hatırlar (`m.infBy`); enfekte ceset hak iddia edeni (`c.plague`);
  enfekte zemin hücresi sahibini (`state.infection.o`, `sideIndex+1`).
- Diriliş, hasat, zemin çürümesi, bölge kredisi, arınma kaybı, yakma kaybı hep sahibine gider.
- Veba bağışıklığı, yaralanmama, "yerden çıkan" üretim, organik görsel = **yetenek bayrakları**
  (`plagueImmune`, `noWounded`, `emergingProduction`, `visual.organic`), isim karşılaştırması değil.

## 7. AI: doktrin + stratejik rol

- **Fraksiyon doktrini** (`new_antioch_ai.js`, `black_grail_ai.js`): fraksiyon nasıl savaşır.
- **Stratejik rol katmanı** (`data/ai.js STRATEGY[faction][role]`): aynı doktrin ne zaman / ne kadar
  taarruza döner. Yeni Antakya saldıran erken ve güçlü vurucu gruplar kurar, hedefe ulaşınca bir sonrakine geçer;
  Kara Kâse savunan evin önünde toplanır, kapıdaki düşmana karşılık verir, gördüğü düşmanı açıkça aşınca ya da savaş
  geç olunca taşar. Her şey komutla; sis dürüst.
- Zorluk yalnızca düşünme aralığıdır (`AI_DIFFICULTY`): kolay 20 / normal 10 / zor 6 tik.

## 8. Maç kurulumu

`resolveSides(scenario, settings)`: `settings.sides` (araçlar/testler) → `settings.setup` (Maç Kurulumu:
`{ mode, playerFaction, enemyFaction, playerRole }`) → eski ayar (`playerFaction` + senaryo lore ön ayarı).
UI yalnız bu düz veriyi üretir. Planlanan fraksiyonlar (`PLANNED_FACTIONS`) kilitli kart olarak görünür.

## 9. Gelecek fraksiyon eklemek (05B / 05C)

Yeni bir fraksiyon için gereken **yalnızca veri + kendi modülleri**:
`FACTIONS[id]` (kart, kaynaklar, ekonomi bayrakları), birim/yapı verisi, `PACKAGES[id].attacker|defender`,
`STRATEGY[id]`, `factions/<id>.js` mantık modülü + `ai/<id>_ai.js` doktrini, `registry` kaydı, i18n.
Çekirdekte `if (faction === …)` gerekmez. Açık bırakılan kancalar (uygulanmadı):

- Iron Sultanate: `scenario.features` (Iron Wall senaryo özelliği), HQ etiketi olan ileri karakol yapıları,
  yapı katmanları için mevcut lineer yapı sistemi.
- Heretic Legion: savaş kampı HQ'su (`hq` etiketi), yeraltı için ileride ayrı bir katman (05D; bugün kod yok).

## 10. Bilinçli olarak yapılmayanlar

Iron Sultanate / Heretic Legion içeriği, Iron Wall, Grand Cannon, Heretic tankı, yeraltı/tünel/Burrower, çok
oyunculu ağ, diplomasi. Üç ve daha fazla taraflı maç: veri modeli hazır (taraf listesi), sis katmanı sayısı 2.
