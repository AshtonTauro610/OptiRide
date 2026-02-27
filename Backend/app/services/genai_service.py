import os
import logging
from typing import List, Dict, Any
from datetime import datetime, timedelta
import google.generativeai as genai

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GenAIService:
    _model = None
    
    _cached_insights: List[str] = []
    _last_generated_time: datetime = None
    _last_input_data: Dict[str, Any] = {}
    
    CACHE_DURATION_MINUTES = 10
    SIGNIFICANT_CHANGE_THRESHOLD = 0.15  # 15% change triggers refresh

    @classmethod
    def _get_model(cls):
        if cls._model:
            return cls._model

        from app.core.config import settings
        api_key = settings.GEMINI_API_KEY

        if not api_key:
            logger.warning("GEMINI_API_KEY not found in settings.")
            return None

        try:
            genai.configure(api_key=api_key)
            cls._model = genai.GenerativeModel('gemini-2.5-flash')
            return cls._model
        except ImportError:
            logger.error("google-generativeai library not installed.")
            return None
        except Exception as e:
            logger.error(f"Error initializing GenAI model: {e}")
            return None

    @classmethod
    def generate_demand_insights(cls, forecast_data: Dict[str, Any]) -> List[str]:
        if cls._is_cache_valid(forecast_data):
           logger.info("Returning cached GenAI insights")
           return cls._cached_insights

        model = cls._get_model()
        if not model:
            return cls._generate_fallback_insights(forecast_data)

        try:
            prompt = cls._construct_prompt(forecast_data)
            response = model.generate_content(prompt)
            
            text = response.text.strip()
            
            if "\n" in text:
                lines = [line.strip().lstrip("-•*").strip() for line in text.split("\n") if line.strip()]
                
                filtered = [
                    l for l in lines 
                    if not l.lower().startswith("here are") 
                    and not l.endswith(":")
                    and len(l) > 10
                ]
                
                result = filtered[:2]
            else:
                result = [text]
            
            if result:
                cls._cached_insights = result
                cls._last_generated_time = datetime.utcnow()
                cls._last_input_data = forecast_data.copy()
            
            return result

        except Exception as e:
            logger.error(f"Error generating GenAI insights: {e}")
            if cls._cached_insights:
                return cls._cached_insights
            return cls._generate_fallback_insights(forecast_data)

    @classmethod
    def _is_cache_valid(cls, current_data: Dict[str, Any]) -> bool:
        if not cls._cached_insights or not cls._last_generated_time:
            return False
            
        elapsed = datetime.utcnow() - cls._last_generated_time
        if elapsed > timedelta(minutes=cls.CACHE_DURATION_MINUTES):
            return False
            
        last = cls._last_input_data
        
        def is_diff(key):
            old = float(last.get(key, 0))
            new = float(current_data.get(key, 0))
            if old == 0: return new > 0
            return abs(new - old) / (old if old > 0 else 1) > cls.SIGNIFICANT_CHANGE_THRESHOLD

        if is_diff('active_backlog') or is_diff('peak_demand'):
            return False
            
        if last.get('peak_hour') != current_data.get('peak_hour'):
            return False

        if last.get('alert_level') != current_data.get('alert_level'):
            return False
            
        return True

    @staticmethod
    def _construct_prompt(data: Dict[str, Any]) -> str:
        now_dubai = datetime.utcnow() + timedelta(hours=4)
        current_time_str = now_dubai.strftime("%H:%M")
        
        imminent_peak = data.get('imminent_peak_demand', 0)
        imminent_hour = data.get('imminent_peak_hour', "N/A")
        
        daily_peak = data.get('daily_peak_demand', 0)
        daily_hour = data.get('daily_peak_hour', "N/A")
        
        alert_level = data.get('alert_level', "NORMAL")
        demand_score = data.get('demand_score', 0.0)
        
        context_note = ""
        backlog = data.get('active_backlog', 0)
        
        if backlog > 10:
             context_note = f"URGENT: High Active Backlog ({backlog} orders). Immediate priority is to clear these orders. Do NOT release drivers until backlog is managed."
        elif imminent_peak > 20:
             context_note = f"URGENT: High demand ({imminent_peak} orders) is IMMINENT at {imminent_hour}. Prioritize this immediately over any later peaks."
        elif daily_peak > imminent_peak * 1.5:
             context_note = f"Note: Moderate current demand, but a major peak is expected later today at {daily_hour}. Suggest preparation."
        elif alert_level == "NORMAL" and daily_peak < 15:
             context_note = "Note: Demand and Backlog are very low. Suggestions should focus on cost-saving or maintenance."
        
        prompt = f"""
        You are an AI assistant for a logistics company.
        Current Local Time: {current_time_str}
        
        Analyze the following demand status (Today Only):
        - Active Order Backlog: {data.get('active_backlog')} orders
        - Current New Order Rate: {data.get('current_arrival_rate')} orders/hour
        
        - IMMINENT Peak (Next 3 Hours): {imminent_peak} orders/hour at {imminent_hour}
        - DAY Peak (Rest of Today): {daily_peak} orders/hour at {daily_hour}
        
        - Demand Severity Score: {demand_score}/1.0 ({alert_level})
        - Available Drivers: {data.get('available_drivers')}
        
        {context_note}
        
        Provide 1-2 concise, actionable operational recommendations for the fleet manager.
        IMPORTANT rules:
        1. Focus ONLY on the Current operating day. Do NOT mention tomorrow.
        2. If "Imminent Peak" is high, prioritize it above all else.
        3. Do not use markdown formatting, bullet points, or numbering. Just plain text.
        4. START DIRECTLY with the first recommendation. Do NOT include any intro like "Here are the recommendations:".
        5. Separate multiple recommendations with a newline.
        """
        return prompt

    @staticmethod
    def _generate_fallback_insights(data: Dict[str, Any]) -> List[str]:
        insights = []
        peak_demand = data.get('peak_demand', 0)
        backlog = data.get('active_backlog', 0)
        
        if backlog > 20:
             insights.append(f"High backlog of {backlog} orders. Prioritize clearing pending orders immediately.")

        if peak_demand > 50:
            insights.append(f"Demand expected to peak at {data.get('peak_hour')} with ~{peak_demand} orders.")
        
        available = data.get('available_drivers', 0)
        if peak_demand > available * 5:
             insights.append("Potential driver shortage expected during peak hours.")
             
        if not insights:
            insights.append("Operations appear stable. Monitor for changes.")
            
        return insights

    @classmethod
    def generate_driver_insights(cls, metrics: Dict[str, Any]) -> List[str]:
        model = cls._get_model()
        if not model:
            return cls._fallback_driver_insights(metrics)
        
        try:
            prompt = f"""
            You are an AI assistant for a logistics fleet management system.

            Analyze this driver's performance metrics and provide 1-2 concise, actionable insights for the fleet manager.

            Driver Metrics:
            - Orders Completed: {metrics.get('orders_completed', 0)}
            - Orders Cancelled: {metrics.get('orders_cancelled', 0)}
            - Total Earnings: AED {metrics.get('total_earnings', 0):.2f}
            - Total Distance: {metrics.get('total_distance', 0):.1f} km
            - Safety Alerts: {metrics.get('safety_alerts', 0)}
            - Safety Score: {metrics.get('safety_score', 100)}/100

            Rules:
            1. Be direct and operational. No markdown, no bullet points, no numbering.
            2. START directly with the first insight. No intro phrases.
            3. Separate multiple insights with a newline.
            4. Focus on the most critical issue first (safety > performance > earnings).
            """
            response = model.generate_content(prompt)
            text = response.text.strip()
            lines = [l.strip().lstrip("-•*").strip() for l in text.split("\n") if l.strip()]
            filtered = [l for l in lines if not l.lower().startswith("here") and not l.endswith(":") and len(l) > 10]
            return filtered[:2] if filtered else cls._fallback_driver_insights(metrics)
        except Exception as e:
            logger.error(f"Error generating driver insights: {e}")
            return cls._fallback_driver_insights(metrics)


    @staticmethod
    def _fallback_driver_insights(metrics: Dict[str, Any]) -> List[str]:
        insights = []
        if metrics.get('safety_score', 100) < 80:
            insights.append(f"Safety score is {metrics.get('safety_score')}/100 with {metrics.get('safety_alerts')} alerts. Review driving behavior immediately.")
        if metrics.get('orders_cancelled', 0) > metrics.get('orders_completed', 1) * 0.2:
            insights.append("High cancellation rate detected. Investigate root cause.")
        if not insights:
            insights.append("Driver performance is within normal range.")
        return insights
    
    @classmethod
    def generate_safety_insights(cls, safety_data: Dict[str, Any]) -> List[str]:
        model = cls._get_model()
        if not model:
            return cls._fallback_safety_insights(safety_data)
        
        try:
            prompt = f"""
            You are an AI safety advisor for a food delivery fleet.

            Analyze the following real-time safety event data and provide 1-2 concise, actionable recommendations for the fleet manager or driver.

            Safety Data:
            - Fatigue Score: {safety_data.get('fatigue_score', 0):.2f}/1.0 (alert level: {safety_data.get('fatigue_alert_level', 'none')})
            - Harsh Braking: {safety_data.get('harsh_braking', False)}
            - Harsh Acceleration: {safety_data.get('harsh_acceleration', False)}
            - Sharp Turn: {safety_data.get('sharp_turn', False)}
            - Sudden Impact: {safety_data.get('sudden_impact', False)}
            - Movement Risk Level: {safety_data.get('movement_risk_level', 'low')}
            - Speed (km/h): {safety_data.get('speed', 0)}

            Rules:
            1. Be direct and urgent if risk is high. No markdown, no bullet points, no numbering.
            2. START directly with the first recommendation. No intro phrases.
            3. Separate multiple recommendations with a newline.
            4. Prioritize: sudden impact > fatigue > harsh driving > speeding.
            """

            response = model.generate_content(prompt)
            text = response.text.strip()
            lines = [l.strip().lstrip("-•*").strip() for l in text.split("\n") if l.strip()]
            filtered = [l for l in lines if not l.lower().startswith("here") and not l.endswith(":") and len(l) > 10]
            return filtered[:2] if filtered else cls._fallback_safety_insights(safety_data)
        
        except Exception as e:
            logger.error(f"Error generating safety insights: {e}")
            return cls._fallback_safety_insights(safety_data)
        
    @staticmethod
    def _fallback_safety_insights(safety_data: Dict[str, Any]) -> List[str]:
        insights = []
        if safety_data.get('sudden_impact'):
            insights.append("Sudden impact detected. Contact driver immediately and assess for accident.")
        if safety_data.get('fatigue_alert_level') == 'critical':
            insights.append("Critical fatigue detected. Driver must stop and rest before continuing.")
        elif safety_data.get('fatigue_alert_level') == 'warning':
            insights.append("Fatigue warning detected. Recommend driver take a short break.")
        if safety_data.get('movement_risk_level') == 'high' and not safety_data.get('sudden_impact'):
            insights.append("Multiple harsh driving events detected. Remind driver of safe driving protocols.")
        if not insights:
            insights.append("No critical safety issues detected. Driver is operating normally.")
        return insights
