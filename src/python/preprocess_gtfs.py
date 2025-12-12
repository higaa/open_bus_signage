#!/usr/bin/env python3

# Copyright (c) 2025 Kenichi Higashide
# Licensed under the MIT License. See LICENSE file in the project root for full license text.

# GTFS前処理スクリプト
# GTFSファイルからデジタルサイネージでの表示に必要な
# 発車時刻やヘッドサインなどの情報を抽出し、JSON形式で保存します。
from datetime import datetime, timedelta
from collections import defaultdict
import zipfile
import logging
import argparse
from typing import Dict, List, Optional, Tuple, Any
import json
import pandas as pd
import os
import partridge as ptg

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s'
)
logger = logging.getLogger(__name__)


class GTFSProcessor:
    """GTFS データを処理してサイネージ用データを生成するクラス"""
    
    def __init__(self, config_file: str):
        """
        初期化
        
        Args:
            config_file: GTFSの設定ファイルパス（必須）
        """
        self.config = self._load_config(config_file)
        
        self.gtfs_files = self._resolve_gtfs_paths(self.config["gtfs_files"])
        self.output_file = self._resolve_output_path(self.config["output_file"])
        self.platform_config = self.config["platform"]
        self.date_change_hour = self.config.get("date_change_hour", 3)
        self.gtfs_providers = list(self.gtfs_files.keys())
        
    def _load_config(self, config_file: str) -> Dict[str, Any]:
        """設定ファイルを読み込む"""
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if not self._validate_config(data):
                raise ValueError("設定ファイルの内容が不正です")
            return data
        except FileNotFoundError:
            raise FileNotFoundError(f"設定ファイルが見つかりません: {config_file}")
        except json.JSONDecodeError as e:
            raise ValueError(f"設定ファイルの形式が不正です: {e}")
        
    def _validate_config(self, data) -> bool:
        """設定の妥当性を検証する"""
        required_keys = ["gtfs_files", "platform", "output_file"]
        for key in required_keys:
            if key not in data:
                logger.error(f"設定ファイルに必須キーがありません: {key}")
                return False    
        
        return True
    
    def _resolve_gtfs_paths(self, gtfs_files_config: Dict[str, str]) -> Dict[str, str]:
        """GTFSファイルパスを新しいディレクトリ構造に合わせて解決する"""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(os.path.dirname(script_dir))
        
        resolved_paths = {}
        for provider, relative_path in gtfs_files_config.items():
            resolved_paths[provider] = os.path.join(project_root, relative_path)
        
        return resolved_paths
    
    def _resolve_output_path(self, output_file: str) -> str:
        """出力ファイルパスを新しいディレクトリ構造に合わせて解決する"""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(os.path.dirname(script_dir))
        
        new_output_path = os.path.join(project_root, output_file)
        
        # 出力ディレクトリが存在しない場合は作成
        if not os.path.exists(os.path.dirname(new_output_path)):
            os.makedirs(os.path.dirname(new_output_path), exist_ok=True)
        
        return new_output_path

    def _read_translations(self, gtfs_file: str) -> Optional[pd.DataFrame]:
        """
        GTFSファイルから翻訳データを読み込む
        
        Args:
            gtfs_file: GTFSファイルのパス
            
        Returns:
            翻訳データのDataFrame（存在しない場合はNone）
        """
        if not os.path.exists(gtfs_file):
            raise FileNotFoundError(f"GTFSファイルが見つかりません: {gtfs_file}")

        try:
            with zipfile.ZipFile(gtfs_file, 'r') as z:
                if 'translations.txt' not in z.namelist():
                    logger.warning(f"translations.txt が見つかりません: {gtfs_file}")
                    return None
                    
                with z.open('translations.txt') as f:
                    translations = pd.read_csv(f, sep=',', encoding='utf-8')
                    return translations
        except Exception as e:
            logger.warning(f"翻訳データの読み込みに失敗しました: {e}")
            return None

    def _get_translation(self, translations: Optional[pd.DataFrame], 
                        table_name: str, field_name: str, 
                        language: str, identifier: str) -> str:
        """
        翻訳データから指定された翻訳を取得する
        
        Args:
            translations: 翻訳データのDataFrame
            table_name: テーブル名
            field_name: フィールド名
            language: 言語コード
            identifier: レコードIDまたはフィールド値
            
        Returns:
            翻訳文字列（見つからない場合は空文字列）
        """
        if translations is None or translations.empty:
            return ''
            
        # record_idでの検索を試行
        mask = (
            (translations['table_name'] == table_name) &
            (translations['field_name'] == field_name) &
            (translations['language'] == language) &
            (translations['record_id'] == identifier)
        )
        matched = translations[mask]
        
        # record_idで見つからない場合、field_valueでの検索を試行
        if matched.empty:
            mask = (
                (translations['table_name'] == table_name) &
                (translations['field_name'] == field_name) &
                (translations['language'] == language) &
                (translations['field_value'] == str(identifier))
            )
            matched = translations[mask]
        
        return matched.iloc[0]['translation'] if not matched.empty else ''

    def _date_to_str(self, date) -> str:
        """datetime.dateをYYYY-MM-DD形式の文字列に変換"""
        return date.strftime('%Y-%m-%d')

    def _process_calendar_data(self, feed, gtfs_prefix: str) -> Dict[str, List[Dict[str, str]]]:
        """
        カレンダーデータを処理する
        
        Args:
            feed: partridgeのfeedオブジェクト
            gtfs_prefix: GTFSプロバイダーのプレフィックス
            
        Returns:
            日付をキーとしたサービスID辞書
        """
        logger.info("カレンダーデータを読み込み中...")
        
        calendar_exists = hasattr(feed, 'calendar') and not feed.calendar.empty
        calendar_dates_exists = hasattr(feed, 'calendar_dates') and not feed.calendar_dates.empty
        
        if not calendar_exists and not calendar_dates_exists:
            logger.warning("calendar および calendar_dates データが見つかりません")
            return {}
        
        calendar = defaultdict(set)
        
        # calendarデータの処理
        if calendar_exists:
            for _, row in feed.calendar.iterrows():
                service_id = row['service_id']
                start_date = row['start_date']
                end_date = row['end_date']
                valid_days = [
                    row['monday'], row['tuesday'], row['wednesday'],
                    row['thursday'], row['friday'], row['saturday'], row['sunday']
                ]
                
                date_range = pd.date_range(start=start_date, end=end_date)
                for date in date_range:
                    day_of_week = date.weekday()
                    if valid_days[day_of_week]:
                        date_str = self._date_to_str(date)
                        calendar[date_str].add((gtfs_prefix, service_id))

        # calendar_datesデータの処理
        if calendar_dates_exists:
            for _, row in feed.calendar_dates.iterrows():
                service_id = row['service_id']
                date = row['date']
                exception_type = row['exception_type']
                
                date_str = self._date_to_str(date)
                if exception_type == 1:  # サービス追加
                    calendar[date_str].add((gtfs_prefix, service_id))
                elif exception_type == 2:  # サービス削除
                    calendar[date_str].discard((gtfs_prefix, service_id))

        # setをlistに変換してdictとして返す
        return {
            date: [{'gtfs_id': gtfs_id, 'service_id': svc_id} 
                   for gtfs_id, svc_id in service_ids] 
            for date, service_ids in calendar.items()
        }

    def _create_departure_record(self, row, trip_row, route_row, gtfs_prefix: str, 
                                translations: Optional[pd.DataFrame]) -> Dict[str, Any]:
        """
        発車情報レコードを作成する
        
        Args:
            row: stop_timesの行データ
            trip_row: tripsの行データ
            route_row: routesの行データ
            gtfs_prefix: GTFSプロバイダーのプレフィックス
            translations: 翻訳データ(translations.txtそのままのDataFrame)
            
        Returns:
            発車情報の辞書
        """
        # headsignの取得（優先順位: stop_headsign > trip_headsign）
        headsign = row.get('stop_headsign', '')
        if pd.isna(headsign) or not headsign:
            headsign = trip_row['trip_headsign'].values[0] if 'trip_headsign' in trip_row.columns else ''
            if pd.isna(headsign):
                headsign = ''
                
        # route_nameの取得（優先順位: route_short_name > route_long_name）
        route_name = route_row['route_short_name'].values[0] if 'route_short_name' in route_row.columns else ''
        if pd.isna(route_name) or not route_name:
            route_name = route_row['route_long_name'].values[0] if 'route_long_name' in route_row.columns else ''
            if pd.isna(route_name):
                route_name = ''
        
        # route_colorとroute_text_colorの取得
        route_color = route_row['route_color'].values[0] if 'route_color' in route_row.columns else ''
        if pd.isna(route_color):
            route_color = ''
            
        route_text_color = route_row['route_text_color'].values[0] if 'route_text_color' in route_row.columns else ''
        if pd.isna(route_text_color):
            route_text_color = ''
            
        # service_idの取得
        service_id = trip_row['service_id'].values[0] if 'service_id' in trip_row.columns else ''
        if pd.isna(service_id):
            service_id = ''
        
        # 英語翻訳の取得
        route_id = trip_row['route_id'].values[0]
        route_name_en = self._get_translation(translations, 'routes', 'route_long_name', 'en', route_id)
        headsign_en = self._get_translation(translations, 'stop_times', 'stop_headsign', 'en', headsign)
        # TODO: translations.txtの別の形式にも対応する

        return {
            'departure_time': row['departure_time'],
            'route_name': str(route_name),
            'route_name_en': str(route_name_en),
            'route_color': str(route_color),
            'route_text_color': str(route_text_color),
            'headsign': str(headsign),
            'headsign_en': str(headsign_en),
            'gtfs_id': str(gtfs_prefix),
            'service_id': str(service_id)
        }

    def _process_stop_departures(self, stop_id_list: List[str], feed, 
                                gtfs_prefix: str, translations: Optional[pd.DataFrame]) -> List[List[Dict[str, Any]]]:
        """
        停留所リストの発車情報を処理する
        
        Args:
            stop_id_list: 停留所IDのリスト
            feed: partridgeのfeedオブジェクト
            gtfs_prefix: GTFSプロバイダーのプレフィックス
            translations: 翻訳データ
            
        Returns:
            停留所ごとの発車情報リスト
        """
        departures_list = []
        
        for stop_id in stop_id_list:
            if stop_id is None:
                departures_list.append([])
                continue
                
            logger.info(f"停留所ID: {stop_id} のデータを処理中...")
            
            # 停留所データの存在チェック
            stop_times = feed.stop_times[
                (feed.stop_times['stop_id'] == stop_id) &
                (feed.stop_times['pickup_type'].isna() | (feed.stop_times['pickup_type'].astype(int) == 0))
            ]
            
            if stop_times.empty:
                logger.warning(f"停留所ID {stop_id} のデータが見つかりません")
                departures_list.append([])
                continue
                
            trips = feed.trips[feed.trips['trip_id'].isin(stop_times['trip_id'])]
            routes = feed.routes[feed.routes['route_id'].isin(trips['route_id'])]
                
            # 発車時刻の抽出と整形
            departures = []
            for _, row in stop_times.iterrows():
                if pd.isna(row['departure_time']):
                    continue
                    
                trip_row = trips[trips['trip_id'] == row['trip_id']]
                if trip_row.empty:
                    continue
                        
                route_id = trip_row['route_id'].values[0]
                route_row = routes[routes['route_id'] == route_id]
                if route_row.empty:
                    continue
                
                departure_record = self._create_departure_record(
                    row, trip_row, route_row, gtfs_prefix, translations
                )
                departures.append(departure_record)
            
            departures_list.append(departures)
        
        return departures_list

    def process_gtfs_data(self) -> Dict[str, Any]:
        """
        GTFSデータを処理してサイネージ用データを生成する
        
        Returns:
            サイネージ用データ辞書
        """
        logger.info("GTFS前処理を開始します...")
        
        # 初期化
        departure_info = {platform_num: [] for platform_num in self.platform_config.keys()}
        calendar = defaultdict(list)

        # 各GTFSプロバイダーのデータを処理
        for provider in self.gtfs_providers:
            gtfs_file = self.gtfs_files[provider]
            if not os.path.exists(gtfs_file):
                raise FileNotFoundError(f"GTFSファイルが見つかりません: {gtfs_file}")
                
            logger.info(f"GTFSファイルを読み込み中: {gtfs_file} (プロバイダー: {provider})")
            feed = ptg.load_feed(gtfs_file)
            
            translations = self._read_translations(gtfs_file)
            if translations is not None and not translations.empty:
                logger.info("翻訳データを読み込みました")

            # プラットフォームごとに停留所データを処理
            for platform_num, stop_configs in self.platform_config.items():
                provider_stops = [stop_id for prov, stop_id in stop_configs if prov == provider]
                
                if provider_stops:
                    gtfs_departure_info = self._process_stop_departures(
                        provider_stops, feed, provider, translations
                    )
                    
                    # 取得したデータをプラットフォームに追加
                    for departures in gtfs_departure_info:
                        if departures:
                            departure_info[platform_num].extend(departures)

            # カレンダーデータを処理
            gtfs_calendar = self._process_calendar_data(feed, provider)
            for date, service_ids in gtfs_calendar.items():
                calendar[date].extend(service_ids)

        
        return {
            'departure_info': departure_info,
            'calendar': dict(calendar),
            'gtfs_id': self.gtfs_providers,
            'date_change_hour': self.date_change_hour
        }

    def save_signage_data(self, signage_data: Dict[str, Any], output_file: str) -> None:
        """
        サイネージデータをJSONファイルに保存する
        
        Args:
            signage_data: サイネージデータ
            output_file: 出力ファイルパス（必須）
        """
        try:
            # 出力ディレクトリが存在しない場合は作成
            output_dir = os.path.dirname(output_file)
            if output_dir:
                os.makedirs(output_dir, exist_ok=True)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(signage_data, f, ensure_ascii=False, indent=2)
            logger.info(f"前処理が完了しました。出力ファイル: {output_file}")
        except IOError as e:
            raise IOError(f"ファイルの保存に失敗しました: {e}")

    def print_statistics(self, signage_data: Dict[str, Any]) -> None:
        """
        統計情報を表示する
        
        Args:
            signage_data: サイネージデータ
        """
        logger.info("統計情報:")
        for platform_num, departures in signage_data['departure_info'].items():
            platform_count = len(departures)
            logger.info(f"プラットフォーム{platform_num}の発車便数: {platform_count}")


def main():
    """メイン処理"""
    # コマンドライン引数のパーサーを設定
    parser = argparse.ArgumentParser(
        description='GTFSデータを前処理してサイネージ用データを生成します',
        epilog='使用例: python preprocess_gtfs.py -c config/gtfs_config.json',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '-c', '--config',
        type=str,
        required=True,
        metavar='CONFIG_FILE',
        help='GTFS設定ファイルのパス（必須）\n例: config/gtfs_config.json'
    )
    
    # カスタムエラーハンドリング
    try:
        args = parser.parse_args()
    except SystemExit as e:
        if e.code != 0:
            logger.error("コマンドライン引数エラー")
            logger.error("")
            logger.error("このスクリプトには以下の引数が必須です：")
            logger.error("  -c, --config : GTFS設定ファイル(JSON)のパス")
            logger.error("")
            logger.error("使用例:")
            logger.error("  python preprocess_gtfs.py -c config/gtfs_config.json")
            logger.error("")
            logger.error("ヘルプを表示するには:")
            logger.error("  python preprocess_gtfs.py --help")
        raise
    
    try:
        # 設定ファイルの存在確認
        if not os.path.exists(args.config):
            logger.error(f"エラー: 設定ファイルが見つかりません: {args.config}")
            logger.error(f"指定されたパスを確認してください。")
            return 1

        
        processor = GTFSProcessor(config_file=args.config)
        signage_data = processor.process_gtfs_data()
        processor.save_signage_data(signage_data, output_file=processor.output_file)
        processor.print_statistics(signage_data)
        
        logger.info("処理が正常に完了しました")
        return 0
        
    except FileNotFoundError as e:
        logger.error(f"ファイルエラー: {e}")
        logger.error("ファイルのパスが正しいか確認してください。")
        return 1
    except ValueError as e:
        logger.error(f"設定エラー: {e}")
        logger.error("設定ファイルの内容を確認してください。")
        return 1
    except Exception as e:
        logger.error(f"予期しないエラーが発生しました: {e}")
        return 1


if __name__ == '__main__':
    exit(main())
