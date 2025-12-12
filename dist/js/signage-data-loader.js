// Copyright (c) 2025 Kenichi Higashide
// Licensed under the MIT License. See LICENSE file in the project root for full license text.
//
// バスサイネージ用データローダー
// 前処理されたJSONデータを読み込む

const DATE_CHANGE_HOUR_DEFAULT = 4;
const SIGNAGE_DATA_URL = './signage_data.json';

class SignageDataLoader {
    constructor() {
        this.signageData = null;
        this.isLoaded = false;
        this.loadPromise = null;

        this.dateDisplaying = null;
        this.signageDataDisplaying = null;
    }

    async loadSignageData() {
        try {
            console.log('データファイルを読み込み中...');
            const response = await fetch(SIGNAGE_DATA_URL);
            console.log('HTTPレスポンス受信:', response.status, response.ok);
            
            if (!response.ok) {
                throw new Error(`HTTPエラー: ${response.status}`);
            }

            this.signageData = await response.json();
            console.log('JSONパース完了。データサイズ:', JSON.stringify(this.signageData).length);
            if (!this.signageData) {
                throw new Error('無効なサイネージデータ形式');
            }

            this.isLoaded = true;
            console.log('サイネージデータの読み込みが完了しました。');

            return this.signageData;
            
        } catch (error) {
            console.error('データ読み込みエラー:', error);
            throw error;
        }
    }

    _convertTime(timeValue) {
        if (typeof timeValue === 'string') {
            return timeValue; // 既にHH:MM:SS形式
        }
        
        if (typeof timeValue === 'number') {
            // 秒数からHH:MM:SS形式に変換
            const hours = Math.floor(timeValue / 3600);
            const minutes = Math.floor((timeValue % 3600) / 60);
            const seconds = Math.floor(timeValue % 60);
            
            const result = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            return result;
        }
        
        console.warn(`無効な時刻値: ${timeValue}`);
        return '00:00:00'; // デフォルト値
    }

    // 現在時刻から指定時間内の発車便を特定のプラットフォームから取得
    getUpcomingDepartures(displayingTime, platformKey, entryNum = 4) {
        if (!this.isLoaded || !this.signageData) {
            console.warn('データが読み込まれていません');
            return [];
        }

        // 日付切り替わり時刻を設定ファイルから取得（デフォルトは定数）
        const dateChangeHour = this.signageData?.date_change_hour ?? DATE_CHANGE_HOUR_DEFAULT;
        
        // 指定時刻より前なら前日の日付にする
        let dateObj = new Date(displayingTime);
        let displayingHours = displayingTime.getHours();
        if (displayingTime.getHours() < dateChangeHour) {
            dateObj.setDate(dateObj.getDate() - 1);
            displayingHours = 24 + displayingHours;
        }
        
        // ローカル時間として日付文字列を取得
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;
        
        console.log('表示日付:', dateString);
        
        // 日付が変わった場合、その日の発車情報を準備
        if (this.dateDisplaying !== dateString) {
            console.log(`日付が変更されました: ${this.dateDisplaying} → ${dateString}`);
            this.dateDisplaying = dateString;
            
            // その日の有効なサービスIDを取得
            const serviceIds = this.signageData.calendar[dateString] || [];
            console.log(`${dateString}の有効なサービスID:`, serviceIds);
            
            // プラットフォームごとにその日の発車情報をフィルタリング
            this.signageDataDisplaying = {};
            
            if (this.signageData.departure_info && typeof this.signageData.departure_info === 'object') {
                for (const [platformNum, platformData] of Object.entries(this.signageData.departure_info)) {
                    // その日に運行するサービスの発車情報のみを抽出
                    const filteredDepartures = (platformData || []).filter(dep => {
                        return serviceIds.some(svc => 
                            svc.gtfs_id === dep.gtfs_id && svc.service_id === dep.service_id
                        );
                    });
                    
                    // 発車時刻でソート
                    filteredDepartures.sort((a, b) => {
                        return a.departure_time - b.departure_time;
                    });
                    
                    this.signageDataDisplaying[platformNum] = filteredDepartures;
                    console.log(`プラットフォーム${platformNum}: ${filteredDepartures.length}便`);
                }
            } else {
                console.warn('departure_infoが無効です:', this.signageData.departure_info);
                return [];
            }
        }

        // データが存在しない場合
        if (!this.signageDataDisplaying) {
            console.warn('発車情報データが見つかりません');
            return [];
        }

        // 指定プラットフォームのデータを取得
        const platformData = this.signageDataDisplaying[platformKey] || [];

        // 現在時刻を秒数で計算
        const currentSeconds = displayingHours * 3600 + 
                              displayingTime.getMinutes() * 60 + 
                              displayingTime.getSeconds();
        
        // 直近の発車便を取得
        const upcomingDepartures = [];
        
        for (const dep of platformData) {
            if (dep.departure_time >= currentSeconds) {
                upcomingDepartures.push({
                    ...dep,
                    time: this._convertTime(dep.departure_time)
                });
            }
        }
        
        // 指定件数まで取得
        const result = upcomingDepartures.slice(0, entryNum);
        
        console.log(`プラットフォーム${platformKey}: ${result.length}便の直近発車情報を返します`);
        return result;
    }

    // 有効なサービスIDを取得
    getValidServiceIds() {
        if (!this.isLoaded || !this.signageData) {
            return [];
        }

        // 現在時刻を取得（テスト用オフセットを考慮）
        let currentTime;
        if (typeof TEST_TIME_OFFSET !== 'undefined' && 
            (TEST_TIME_OFFSET.minutes !== 0 || TEST_TIME_OFFSET.days !== 0)) {
            
            const now = new Date();
            const offsetDate = new Date(now);
            
            if (TEST_TIME_OFFSET.days !== 0) {
                offsetDate.setDate(offsetDate.getDate() + TEST_TIME_OFFSET.days);
            }
            if (TEST_TIME_OFFSET.minutes !== 0) {
                offsetDate.setMinutes(offsetDate.getMinutes() + TEST_TIME_OFFSET.minutes);
            }
            
            currentTime = offsetDate;
        } else {
            currentTime = new Date();
        }
        const currentDate = currentTime.toISOString().split('T')[0]; // YYYY-MM-DD形式

        // カレンダーデータから有効なサービスIDを取得
        if (!this.signageData.calendar || typeof this.signageData.calendar !== 'object') {
            console.warn('カレンダーデータが無効です:', this.signageData.calendar);
            return [];
        }

        const service_ids = this.signageData.calendar[currentDate] || [];
        if (!Array.isArray(service_ids)) {
            console.warn(`無効なサービスIDデータ形式: ${currentDate}`, service_ids);
            return [];
        }

        console.log(`${currentDate}の有効なサービスID:`, service_ids);
        return service_ids;
    }

    // データが読み込まれているかチェック
    get isDataLoaded() {
        return this.isLoaded && this.signageData !== null;
    }

    // サイネージデータ全体を取得
    getSignageData() {
        return this.signageData;
    }

    // 駅名取得（日本語）
    getStationName() {
        return this.signageData ? this.signageData.station_name : '';
    }

    // 駅名取得（英語）
    getStationNameEn() {
        return this.signageData ? this.signageData.station_name_en : '';
    }
}
