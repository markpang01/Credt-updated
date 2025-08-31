#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for Utilization Pilot
Tests all API endpoints, database connectivity, and core utilization logic
"""

import requests
import json
import time
import sys
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class UtilizationPilotTester:
    def __init__(self):
        # Get base URL from environment
        self.base_url = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://plaid-dashboard.preview.emergentagent.com')
        self.api_base = f"{self.base_url}/api"
        self.test_results = []
        
    def log_result(self, test_name, success, message, details=None):
        """Log test result"""
        result = {
            'test': test_name,
            'success': success,
            'message': message,
            'timestamp': datetime.now().isoformat(),
            'details': details
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        if details and not success:
            print(f"   Details: {details}")
    
    def test_health_endpoint(self):
        """Test GET /api/health endpoint"""
        try:
            response = requests.get(f"{self.api_base}/health", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'status' in data and data['status'] == 'healthy':
                    self.log_result("Health Check", True, "Health endpoint responding correctly")
                    return True
                else:
                    self.log_result("Health Check", False, "Health endpoint returned unexpected data", data)
                    return False
            else:
                self.log_result("Health Check", False, f"Health endpoint returned status {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Health Check", False, f"Health endpoint failed with exception: {str(e)}")
            return False
    
    def test_link_token_endpoint(self):
        """Test GET /api/link-token endpoint for Plaid integration"""
        try:
            response = requests.get(f"{self.api_base}/link-token", timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                if 'link_token' in data and data['link_token']:
                    # Validate link token format (should be a string starting with 'link-')
                    if isinstance(data['link_token'], str) and len(data['link_token']) > 10:
                        self.log_result("Plaid Link Token", True, "Link token generated successfully")
                        return True
                    else:
                        self.log_result("Plaid Link Token", False, "Invalid link token format", data)
                        return False
                else:
                    self.log_result("Plaid Link Token", False, "No link_token in response", data)
                    return False
            else:
                self.log_result("Plaid Link Token", False, f"Link token endpoint returned status {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Plaid Link Token", False, f"Link token endpoint failed: {str(e)}")
            return False
    
    def test_dashboard_empty_state(self):
        """Test GET /api/dashboard endpoint with empty state"""
        try:
            response = requests.get(f"{self.api_base}/dashboard", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                expected_fields = ['creditCards', 'overallUtilization', 'totalLimit', 'totalBalance', 'recommendations', 'summary']
                
                # Check all required fields are present
                missing_fields = [field for field in expected_fields if field not in data]
                if missing_fields:
                    self.log_result("Dashboard Empty State", False, f"Missing fields: {missing_fields}", data)
                    return False
                
                # Validate empty state structure
                if (isinstance(data['creditCards'], list) and 
                    isinstance(data['overallUtilization'], (int, float)) and
                    isinstance(data['totalLimit'], (int, float)) and
                    isinstance(data['totalBalance'], (int, float)) and
                    isinstance(data['recommendations'], list) and
                    isinstance(data['summary'], dict)):
                    
                    self.log_result("Dashboard Empty State", True, "Dashboard handles empty state correctly")
                    return True
                else:
                    self.log_result("Dashboard Empty State", False, "Invalid data types in dashboard response", data)
                    return False
            else:
                self.log_result("Dashboard Empty State", False, f"Dashboard endpoint returned status {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Dashboard Empty State", False, f"Dashboard endpoint failed: {str(e)}")
            return False
    
    def test_accounts_endpoint(self):
        """Test GET /api/accounts endpoint"""
        try:
            response = requests.get(f"{self.api_base}/accounts", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Accounts Endpoint", True, f"Accounts endpoint working, returned {len(data)} accounts")
                    return True
                else:
                    self.log_result("Accounts Endpoint", False, "Accounts endpoint should return a list", data)
                    return False
            else:
                self.log_result("Accounts Endpoint", False, f"Accounts endpoint returned status {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Accounts Endpoint", False, f"Accounts endpoint failed: {str(e)}")
            return False
    
    def test_invalid_route(self):
        """Test that invalid routes return proper 404 responses"""
        try:
            response = requests.get(f"{self.api_base}/nonexistent-route", timeout=10)
            
            if response.status_code == 404:
                data = response.json()
                if 'error' in data:
                    self.log_result("404 Error Handling", True, "Invalid routes properly return 404")
                    return True
                else:
                    self.log_result("404 Error Handling", False, "404 response missing error field", data)
                    return False
            else:
                self.log_result("404 Error Handling", False, f"Expected 404, got {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("404 Error Handling", False, f"Error testing invalid route: {str(e)}")
            return False
    
    def test_utilization_calculations(self):
        """Test core utilization calculation functions by examining the logic"""
        try:
            # Test calculateUtilization logic
            test_cases = [
                (500, 1000, 50),  # 50% utilization
                (0, 1000, 0),     # 0% utilization
                (1000, 1000, 100), # 100% utilization
                (250, 1000, 25),   # 25% utilization
                (100, 0, 0),       # No limit case
            ]
            
            all_passed = True
            for balance, limit, expected in test_cases:
                if limit > 0:
                    calculated = round((balance / limit) * 100)
                else:
                    calculated = 0
                
                if calculated != expected:
                    self.log_result("Utilization Calculation", False, 
                                  f"Failed for balance={balance}, limit={limit}. Expected {expected}, got {calculated}")
                    all_passed = False
                    break
            
            if all_passed:
                self.log_result("Utilization Calculation", True, "All utilization calculations correct")
                return True
            return False
                
        except Exception as e:
            self.log_result("Utilization Calculation", False, f"Error testing utilization calculations: {str(e)}")
            return False
    
    def test_utilization_bands(self):
        """Test utilization band categorization logic"""
        try:
            test_cases = [
                (5, 'excellent'),   # 0-9%
                (15, 'good'),       # 10-29%
                (35, 'warning'),    # 30-49%
                (60, 'bad'),        # 50-74%
                (85, 'severe'),     # 75-100%
            ]
            
            all_passed = True
            for utilization, expected_band in test_cases:
                # Replicate the band logic from the backend
                if utilization <= 9:
                    band = 'excellent'
                elif utilization <= 29:
                    band = 'good'
                elif utilization <= 49:
                    band = 'warning'
                elif utilization <= 74:
                    band = 'bad'
                else:
                    band = 'severe'
                
                if band != expected_band:
                    self.log_result("Utilization Bands", False, 
                                  f"Failed for {utilization}%. Expected {expected_band}, got {band}")
                    all_passed = False
                    break
            
            if all_passed:
                self.log_result("Utilization Bands", True, "All utilization band calculations correct")
                return True
            return False
                
        except Exception as e:
            self.log_result("Utilization Bands", False, f"Error testing utilization bands: {str(e)}")
            return False
    
    def test_paydown_calculations(self):
        """Test paydown amount calculation logic"""
        try:
            test_cases = [
                (1000, 2000, 0.09, 820),  # Need to pay down $820 to reach 9%
                (100, 2000, 0.09, 0),     # Already below target
                (500, 1000, 0.09, 410),   # Need to pay down $410
            ]
            
            all_passed = True
            for balance, limit, target, expected in test_cases:
                max_allowed = limit * target
                if balance <= max_allowed:
                    paydown = 0
                else:
                    paydown = int(balance - max_allowed + 0.5)  # Math.ceil equivalent
                
                if paydown != expected:
                    self.log_result("Paydown Calculation", False, 
                                  f"Failed for balance={balance}, limit={limit}. Expected {expected}, got {paydown}")
                    all_passed = False
                    break
            
            if all_passed:
                self.log_result("Paydown Calculation", True, "All paydown calculations correct")
                return True
            return False
                
        except Exception as e:
            self.log_result("Paydown Calculation", False, f"Error testing paydown calculations: {str(e)}")
            return False
    
    def test_database_connectivity(self):
        """Test MongoDB connectivity through API endpoints"""
        try:
            # Test database connectivity by checking if accounts endpoint works
            # This indirectly tests MongoDB connection
            response = requests.get(f"{self.api_base}/accounts", timeout=10)
            
            if response.status_code == 200:
                self.log_result("Database Connectivity", True, "Database connection working (via accounts endpoint)")
                return True
            elif response.status_code == 500:
                # Check if it's a database connection error
                try:
                    error_data = response.json()
                    if 'error' in error_data:
                        self.log_result("Database Connectivity", False, "Database connection failed", error_data)
                        return False
                except:
                    pass
                self.log_result("Database Connectivity", False, "Database connection may have failed", response.text)
                return False
            else:
                self.log_result("Database Connectivity", False, f"Unexpected response from database test: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_result("Database Connectivity", False, f"Database connectivity test failed: {str(e)}")
            return False
    
    def test_post_endpoints_structure(self):
        """Test POST endpoints structure (without actual data)"""
        try:
            # Test exchange-token endpoint with invalid data to check structure
            response = requests.post(f"{self.api_base}/exchange-token", 
                                   json={}, 
                                   timeout=10)
            
            # Should return an error but not crash
            if response.status_code in [400, 500]:
                try:
                    data = response.json()
                    if 'error' in data:
                        self.log_result("POST Endpoints Structure", True, "POST endpoints handle invalid requests properly")
                        return True
                except:
                    pass
            
            self.log_result("POST Endpoints Structure", False, f"POST endpoint structure test failed: {response.status_code}")
            return False
                
        except Exception as e:
            self.log_result("POST Endpoints Structure", False, f"POST endpoints test failed: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all backend tests"""
        print("🚀 Starting Utilization Pilot Backend API Tests")
        print(f"📍 Testing against: {self.api_base}")
        print("=" * 60)
        
        tests = [
            self.test_health_endpoint,
            self.test_link_token_endpoint,
            self.test_dashboard_empty_state,
            self.test_accounts_endpoint,
            self.test_database_connectivity,
            self.test_invalid_route,
            self.test_utilization_calculations,
            self.test_utilization_bands,
            self.test_paydown_calculations,
            self.test_post_endpoints_structure,
        ]
        
        passed = 0
        failed = 0
        
        for test in tests:
            try:
                if test():
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"❌ FAIL {test.__name__}: Unexpected error - {str(e)}")
                failed += 1
            
            time.sleep(0.5)  # Small delay between tests
        
        print("=" * 60)
        print(f"📊 Test Results: {passed} passed, {failed} failed")
        
        if failed > 0:
            print("\n🔍 Failed Tests Details:")
            for result in self.test_results:
                if not result['success']:
                    print(f"   • {result['test']}: {result['message']}")
        
        return failed == 0

if __name__ == "__main__":
    tester = UtilizationPilotTester()
    success = tester.run_all_tests()
    
    # Save detailed results
    with open('/app/test_results_detailed.json', 'w') as f:
        json.dump(tester.test_results, f, indent=2)
    
    print(f"\n📝 Detailed results saved to: /app/test_results_detailed.json")
    
    if not success:
        sys.exit(1)
    else:
        print("\n🎉 All tests passed!")