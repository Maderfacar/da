export default {
  nav: {
    orders: '注文',
    book: '予約',
  },
  banner: {
    addFriend: 'LINEアカウントを追加してリアルタイム通知を受け取る',
    addBtn: '+ 友達追加',
  },
  tab: {
    home: 'ホーム',
    trips: '旅程',
    book: '予約',
    fleet: '車種',
    orders: '注文',
  },
  status: {
    confirmed: '確認済み',
    pending: '確認待ち',
    'in-progress': '進行中',
    completed: '完了',
    cancelled: 'キャンセル',
  },
  home: {
    hero: {
      tag: '✈ プレミアム空港送迎',
      subtitle: 'すべての旅に、忘れられない記憶を。出発から到着まで、私たちがお守りします。',
      cta: {
        book: '今すぐ予約',
        fare: '料金試算',
      },
    },
    stats: {
      ontime: '時間通り',
      journeys: '完了旅程',
      rating: '評価',
      service: 'サービス',
    },
    upcoming: {
      title: 'まもなく出発の旅程',
      desc: '次の旅の準備が整いました。ドライバーがお待ちしております。',
      date: '日付',
      pickupTime: '出迎え時間',
      dropoffTime: '送り届け時間',
      vehicle: '車種',
      driver: 'ドライバー',
      passengers: '乗客数',
    },
    book: {
      title: '旅程を予約する',
      desc: '出発情報を入力すると、専属ドライバーが準備いたします。',
      btn: '予約フォームへ',
    },
  },
  fleet: {
    title: '車両ラインナップ',
    spec: {
      capacity: '最大乗客数',
      luggage: '荷物容量',
      baseFare: '基本料金',
      perKm: '1kmあたり',
    },
    unit: {
      person: '名',
      piece: '個',
    },
    desc: {
      sedan: '小さなご家族や個人のビジネス旅行に最適。快適で経済的な選択肢。',
      suv: '広々とした車内と豊富な荷物スペース。家族旅行の最良の選択。',
      van: '大グループや大量の荷物に対応。長距離送迎に最適な最大乗客数。',
      premium: 'プレミアムビジネスクラス。レザー内装と専門的な接客サービス。',
    },
    estimate: {
      label: '試算例（約{km}km）',
      note: '実際の料金はルートとオプションによって異なります。NT$50単位で切り上げ。',
    },
    bookBtn: 'この車種を予約',
    extras: {
      title: '追加サービス',
      'baby-seat': 'チャイルドシート',
      wheelchair: '車椅子サポート',
      'pickup-sign': '出迎えサイン',
      'flight-tracking': 'フライト追跡',
    },
  },
  upcoming: {
    title: '旅程一覧',
    tab: {
      all: 'すべて',
      pending: '確認待ち',
      confirmed: '確認済み',
      'in-progress': '進行中',
      completed: '完了',
    },
    section: {
      upcoming: 'まもなく出発',
      past: '過去の旅程',
    },
    meta: {
      type: '旅程タイプ',
      date: '日付',
      time: '時間',
      vehicle: '車種',
      passengers: '乗客数',
      fare: '予想料金',
    },
    unit: { person: '名' },
    empty: {
      text: '該当する旅程が見つかりません',
      btn: '今すぐ予約',
    },
    cta: '✈ 新しい旅程を予約',
    detail: '詳細を見る',
  },
  booking: {
    step: {
      1: '旅程タイプ',
      2: 'ルート計画',
      3: '乗車要件',
      4: '注文確認',
    },
    newOrder: '再予約',
    success: {
      title: '注文を送信しました',
      orderLabel: '注文番号',
    },
  },
  common: {
    goHome: 'ホームに戻る',
    bookNow: '今すぐ予約',
  },
  enum: {
    apiStatus: {
      200: '成功',
      400: '失敗',
      401: '未認証',
      403: 'アクセス禁止',
      404: '見つかりません',
      500: 'サーバーエラー',
    },
  },
};
