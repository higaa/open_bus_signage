// Copyright (c) 2025 Kenichi Higashide
// Licensed under the MIT License. See LICENSE file in the project root for full license text.
//
// バスサイネージアプリケーション

// URLハッシュから時刻オフセットを取得する関数
function getTimeOffsetFromUrl() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#')) {
        const offsetStr = hash.substring(1);
        const offsetMinutes = parseInt(offsetStr, 10);
        if (!isNaN(offsetMinutes)) {
            return offsetMinutes;
        }
    }
    return 0; // デフォルトはオフセットなし
}

// オフセットを適用した現在時刻を取得する関数
function getCurrentTime() {
    const offsetMinutes = getTimeOffsetFromUrl();
    let now = new Date();
    if (offsetMinutes !== 0) {
        now.setMinutes(now.getMinutes() + offsetMinutes);
    }
    return now;
}

class BusSignageApp {
    constructor() {
        this.dataLoader = new SignageDataLoader();
        this.updateInterval = 30000; // 30秒ごとに更新
        this.timeInterval = 1000; // 1秒ごとに時刻更新
        this.displayingTime = null;
        this.init();
    }

    async init() {
        console.log('バスサイネージアプリを初期化中...');
        
        try {
            // 現在時刻の表示を開始
            console.log('時刻表示を開始...');
            this.updateCurrentTime();
            setInterval(() => this.updateCurrentTime(), this.timeInterval);
            
            // サイネージデータを読み込み
            console.log('サイネージデータを読み込み中...');
            await this.dataLoader.loadSignageData();
            console.log('データ読み込み完了');
            
            // 初回表示
            console.log('初回表示を実行中...');
            this.updateBusSchedules();
            
            // 定期更新を開始
            setInterval(() => this.updateBusSchedules(), this.updateInterval);
            
            console.log('バスサイネージアプリの初期化完了');
            
        } catch (error) {
            console.error('初期化エラー詳細:', error);
            console.error('エラースタック:', error.stack);
            this.showError(`システムの初期化に失敗しました: ${error.message}`);
        }
    }

    // 現在時刻を画面に表示
    updateCurrentTime() {
        const displayTime = getCurrentTime();
        
        const timeString = displayTime.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const currentTimeElement = document.getElementById('currentTime');
        if (currentTimeElement) {
            currentTimeElement.style.background = 'transparent';
            currentTimeElement.style.padding = '0';
            currentTimeElement.textContent = timeString;
        }
    }

    // バスの発車時刻を更新
    updateBusSchedules() {
        console.log('バス時刻表を更新中...');
        
        if (!this.dataLoader.isLoaded) {
            console.warn('データが読み込まれていません');
            return;
        }

        this.displayingTime = getCurrentTime();
        
        // signage_data.jsonのdeparture_infoキーを動的に取得して処理
        const signageData = this.dataLoader.getSignageData();
        if (!signageData || !signageData.departure_info) {
            console.warn('departure_infoデータが見つかりません');
            return;
        }

        const platformKeys = Object.keys(signageData.departure_info);
        // console.log('検出されたプラットフォームキー:', platformKeys);

        platformKeys.forEach(platformKey => {
            const departures = this.dataLoader.getUpcomingDepartures(this.displayingTime, platformKey, 5);
            
            // 表示を更新
            this.updatePlatformDisplay(platformKey, departures);
            console.log(`プラットフォーム${platformKey}: ${departures.length}便`);
        });
    }

    updatePlatformDisplay(platformKey, departures) {
        const platformElement = document.getElementById(`platform_${platformKey}`);
        if (!platformElement) {
            console.warn(`プラットフォーム${platformKey}の要素が見つかりません (ID: platform_${platformKey})`);
            return;
        }

        // 発車リストをクリア
        platformElement.innerHTML = '';

        if (departures.length === 0) {
            platformElement.innerHTML = '<div class="no-departures"><p>本日の運行は終了しました</p><p>Today\'s service has ended</p></div>';
            return;
        }

        // 最大表示件数（表示領域に合わせて調整）
        const maxDisplay = 5;
        const displayDepartures = departures.slice(0, maxDisplay);

        displayDepartures.forEach((departure, index) => {
            const departureElement = this.createDepartureElement(departure);
            platformElement.appendChild(departureElement);
        });
    }

    createDepartureElement(departure) {
        const div = document.createElement('div');
        div.className = `departure-item`;

        // 発車時刻の表示
        const timeStr = departure.time.substring(0, 5); // HH:MM形式
        
        // 路線名と行先の表示（日本語/英語両方）
        const routeName = departure.route_name || '';
        const routeNameEn = departure.route_name_en || '';
        
        // 色コードに#を追加（データには#が含まれていない場合）
        let routeColor = departure.route_color || '4CAF50';
        let routeTextColor = departure.route_text_color || 'FFFFFF';
        
        if (!routeColor.startsWith('#')) {
            routeColor = '#' + routeColor;
        }
        if (!routeTextColor.startsWith('#')) {
            routeTextColor = '#' + routeTextColor;
        }
        
        const destination = departure.headsign || '';
        const destinationEn = departure.headsign_en || '';
        
        div.innerHTML = `
            <div class="departure-time">${timeStr}</div>
            <div class="departure-info">
                <div class="route-info" style="color: ${routeTextColor}; background-color: ${routeColor};">
                    <div class="route-name-ja-container scrollable-container">
                        <div class="route-name-ja scrollable-text">${routeName}</div>
                    </div>
                    <div class="route-name-en-container scrollable-container">
                        <div class="route-name-en scrollable-text">${routeNameEn}</div>
                    </div>
                </div>
                <div class="destination-info">
                    <div class="destination-ja-container scrollable-container">
                        <div class="destination-ja scrollable-text">${destination}</div>
                    </div>
                    <div class="destination-en-container scrollable-container">
                        <div class="destination-en scrollable-text">${destinationEn}</div>
                    </div>
                </div>
            </div>
        `;
        
        // 長いテキストに自動スクロールを適用（レンダリング後に実行）
        setTimeout(() => {
            this.applyScrollAnimationIfNeeded(div);
        }, 300);
        
        return div;
    }

    applyScrollAnimationIfNeeded(element) {
        // 各テキスト要素とその親コンテナを取得
        const textElements = [
            { text: element.querySelector('.route-name-ja'), container: element.querySelector('.route-name-ja-container') },
            { text: element.querySelector('.route-name-en'), container: element.querySelector('.route-name-en-container') },
            { text: element.querySelector('.destination-ja'), container: element.querySelector('.destination-ja-container') },
            { text: element.querySelector('.destination-en'), container: element.querySelector('.destination-en-container') }
        ];
        
        textElements.forEach(({ text, container }) => {
            if (!text || !container) {
                console.warn('テキスト要素またはコンテナが見つかりません:', text, container);
                return;
            }
            
            // 一度スクロールクラスを削除してから幅を測定
            text.classList.remove('scrolling');
            
            // コンテナとテキストの幅を測定
            const containerWidth = container.offsetWidth;
            const textWidth = text.scrollWidth;

            console.debug(`テキスト: "${text.textContent.trim()}", コンテナ幅: ${containerWidth}px, テキスト幅: ${textWidth}px`);

            // テキストがコンテナより長い場合にスクロールを適用
            if (textWidth > containerWidth) {
                const scrollDistance = textWidth - containerWidth;
                
                // CSS変数でスクロール距離を設定
                text.style.setProperty('--scroll-distance', `-${scrollDistance}px`);
                
                // スクロールクラスを追加
                text.classList.add('scrolling');
                console.debug(`スクロール適用: ${scrollDistance}px`);
            } else {
                // テキストが短い場合はスクロールクラスを削除
                text.classList.remove('scrolling');
                console.debug('スクロール不要');
            }
        });
    }


    showError(message) {
        // 動的にプラットフォーム要素を探してエラー表示
        const signageData = this.dataLoader?.getSignageData();
        let platformKeys = ['1', '2']; // HTMLの固定IDに合わせたデフォルト値
        
        if (signageData && signageData.departure_info) {
            platformKeys = Object.keys(signageData.departure_info);
        }
        
        platformKeys.forEach(platformKey => {
            const elementId = `platform_${platformKey}`;
            const element = document.getElementById(elementId);
            if (element) {
                element.innerHTML = `<div class="loading">エラー: ${message}</div>`;
            } else {
                console.warn(`エラー表示用の要素が見つかりません: ${elementId}`);
            }
        });
    }
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('DOMが読み込まれました - アプリケーションを開始します');
        new BusSignageApp();
    } catch (error) {
        console.error('アプリケーション開始エラー:', error);
        
        // エラーの場合はシンプルなフォールバック表示
        document.body.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f0f0; font-family: Arial, sans-serif;">
                <div style="text-align: center; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                    <h1 style="color: #333; margin-bottom: 10px;">システムエラー</h1>
                    <p style="color: #666;">アプリケーションの初期化に失敗しました</p>
                    <p style="color: #999; font-size: 0.9em;">コンソールを確認してください</p>
                </div>
            </div>
        `;
    }
});
