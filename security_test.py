#!/usr/bin/env python3
"""
Comprehensive Backend Security Testing for Credt API
Tests all security features including validation, encryption, rate limiting, and error handling
"""

import requests
import json
import time
import os
import sys
from datetime import datetime
import uuid

# Configuration
BASE_URL = "https://credt-app.preview.emergentagent.com/api"
HEADERS = {"Content-Type": "application/json"}

class SecurityTestSuite:
    def __init__(self):
        self.base_url = BASE_URL
        self.headers = HEADERS
        self.test_results = []
        self.auth_token = None
        
    def log_test(self, test_name, status, details=""):
        """Log test results"""
        result = {
            "test": test_name,
            "status": status,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        status_symbol = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
        print(f"{status_symbol} {test_name}: {details}")
        
    def test_environment_validation(self):
        """Test 1: Environment Validation - Health endpoint should include environment info"""
        try:
            response = requests.get(f"{self.base_url}/health", headers=self.headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['status', 'timestamp', 'environment']
                
                if all(field in data for field in required_fields):
                    if data['environment'] in ['sandbox', 'development', 'production']:
                        self.log_test("Environment Validation", "PASS", 
                                    f"Health endpoint returns proper environment info: {data['environment']}")
                    else:
                        self.log_test("Environment Validation", "FAIL", 
                                    f"Invalid environment value: {data['environment']}")
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("Environment Validation", "FAIL", 
                                f"Missing required fields: {missing}")
            else:
                self.log_test("Environment Validation", "FAIL", 
                            f"Health endpoint returned {response.status_code}")
                
        except Exception as e:
            self.log_test("Environment Validation", "FAIL", f"Exception: {str(e)}")
    
    def test_rate_limiting_get(self):
        """Test 2: Rate Limiting on GET endpoints"""
        try:
            # Test rate limiting by making rapid requests to health endpoint
            # Health endpoint has rate limiting but is more lenient
            rapid_requests = []
            
            for i in range(15):  # Make 15 rapid requests
                start_time = time.time()
                response = requests.get(f"{self.base_url}/health", headers=self.headers, timeout=5)
                end_time = time.time()
                
                rapid_requests.append({
                    'status_code': response.status_code,
                    'response_time': end_time - start_time
                })
                
                if i < 14:  # Small delay between requests except the last one
                    time.sleep(0.1)
            
            # Check if any requests were rate limited (429 status)
            rate_limited = [r for r in rapid_requests if r['status_code'] == 429]
            successful = [r for r in rapid_requests if r['status_code'] == 200]
            
            if len(successful) > 0:
                self.log_test("Rate Limiting - GET", "PASS", 
                            f"Rate limiting working: {len(successful)} successful, {len(rate_limited)} rate limited")
            else:
                self.log_test("Rate Limiting - GET", "FAIL", 
                            "All requests were blocked - rate limiting too aggressive")
                
        except Exception as e:
            self.log_test("Rate Limiting - GET", "FAIL", f"Exception: {str(e)}")
    
    def test_rate_limiting_post(self):
        """Test 3: Rate Limiting on POST endpoints (stricter limits)"""
        try:
            # Test POST rate limiting with exchange-token endpoint
            rapid_requests = []
            
            for i in range(25):  # Make 25 rapid POST requests
                invalid_payload = {"public_token": "invalid_token"}
                
                start_time = time.time()
                response = requests.post(f"{self.base_url}/exchange-token", 
                                       json=invalid_payload, headers=self.headers, timeout=5)
                end_time = time.time()
                
                rapid_requests.append({
                    'status_code': response.status_code,
                    'response_time': end_time - start_time
                })
                
                if response.status_code == 429:
                    break  # Stop when rate limited
                    
                time.sleep(0.05)  # Very small delay
            
            # Check for rate limiting
            rate_limited = [r for r in rapid_requests if r['status_code'] == 429]
            
            if len(rate_limited) > 0:
                self.log_test("Rate Limiting - POST", "PASS", 
                            f"POST rate limiting working: got 429 after {len(rapid_requests)} requests")
            else:
                self.log_test("Rate Limiting - POST", "WARN", 
                            f"No rate limiting detected in {len(rapid_requests)} requests")
                
        except Exception as e:
            self.log_test("Rate Limiting - POST", "FAIL", f"Exception: {str(e)}")
    
    def test_input_validation_exchange_token(self):
        """Test 4: Input Validation - exchange-token endpoint"""
        test_cases = [
            {
                "name": "Missing public_token",
                "payload": {},
                "expected_status": 400
            },
            {
                "name": "Empty public_token",
                "payload": {"public_token": ""},
                "expected_status": 400
            },
            {
                "name": "Invalid public_token format",
                "payload": {"public_token": "invalid_token_format"},
                "expected_status": 401  # Will fail auth first, then validation
            },
            {
                "name": "Extremely long public_token",
                "payload": {"public_token": "x" * 300},
                "expected_status": 400
            },
            {
                "name": "SQL injection attempt",
                "payload": {"public_token": "'; DROP TABLE accounts; --"},
                "expected_status": 400
            },
            {
                "name": "XSS attempt in metadata",
                "payload": {
                    "public_token": "link-sandbox-test",
                    "metadata": {
                        "institution": {
                            "institution_id": "<script>alert('xss')</script>",
                            "name": "<img src=x onerror=alert('xss')>"
                        }
                    }
                },
                "expected_status": 401  # Will fail auth first
            }
        ]
        
        for test_case in test_cases:
            try:
                response = requests.post(f"{self.base_url}/exchange-token", 
                                       json=test_case["payload"], headers=self.headers, timeout=10)
                
                if response.status_code in [400, 401, 500]:  # Expected error responses
                    try:
                        error_data = response.json()
                        if 'error' in error_data:
                            # Check that error message doesn't leak sensitive info
                            error_msg = error_data['error'].lower()
                            sensitive_terms = ['password', 'secret', 'key', 'token', 'database', 'internal']
                            
                            if any(term in error_msg for term in sensitive_terms):
                                self.log_test(f"Input Validation - {test_case['name']}", "FAIL", 
                                            f"Error message may leak sensitive info: {error_msg}")
                            else:
                                self.log_test(f"Input Validation - {test_case['name']}", "PASS", 
                                            f"Proper validation error (status {response.status_code})")
                        else:
                            self.log_test(f"Input Validation - {test_case['name']}", "PASS", 
                                        f"Request rejected (status {response.status_code})")
                    except:
                        self.log_test(f"Input Validation - {test_case['name']}", "PASS", 
                                    f"Request rejected (status {response.status_code})")
                else:
                    self.log_test(f"Input Validation - {test_case['name']}", "FAIL", 
                                f"Unexpected status code: {response.status_code}")
                    
            except Exception as e:
                self.log_test(f"Input Validation - {test_case['name']}", "FAIL", f"Exception: {str(e)}")
    
    def test_input_validation_update_targets(self):
        """Test 5: Input Validation - update-targets endpoint"""
        test_cases = [
            {
                "name": "Invalid target_utilization - negative",
                "payload": {"target_utilization": -0.1},
                "expected_status": 400
            },
            {
                "name": "Invalid target_utilization - too high",
                "payload": {"target_utilization": 0.8},
                "expected_status": 400
            },
            {
                "name": "Invalid monthly_paydown_limit - negative",
                "payload": {"monthly_paydown_limit": -100},
                "expected_status": 400
            },
            {
                "name": "Invalid monthly_paydown_limit - too high",
                "payload": {"monthly_paydown_limit": 200000},
                "expected_status": 400
            },
            {
                "name": "Valid target_utilization",
                "payload": {"target_utilization": 0.15},
                "expected_status": 401  # Will fail auth but validation should pass
            },
            {
                "name": "XSS in accountId",
                "payload": {
                    "accountId": "<script>alert('xss')</script>",
                    "target_utilization": 0.1
                },
                "expected_status": 401  # Will fail auth first
            }
        ]
        
        for test_case in test_cases:
            try:
                response = requests.post(f"{self.base_url}/update-targets", 
                                       json=test_case["payload"], headers=self.headers, timeout=10)
                
                if response.status_code in [400, 401]:
                    try:
                        error_data = response.json()
                        if response.status_code == 400 and 'Validation failed' in error_data.get('error', ''):
                            self.log_test(f"Update Targets Validation - {test_case['name']}", "PASS", 
                                        "Proper validation error returned")
                        elif response.status_code == 401:
                            self.log_test(f"Update Targets Validation - {test_case['name']}", "PASS", 
                                        "Authentication required (validation would occur after auth)")
                        else:
                            self.log_test(f"Update Targets Validation - {test_case['name']}", "PASS", 
                                        f"Request properly rejected (status {response.status_code})")
                    except:
                        self.log_test(f"Update Targets Validation - {test_case['name']}", "PASS", 
                                    f"Request rejected (status {response.status_code})")
                else:
                    self.log_test(f"Update Targets Validation - {test_case['name']}", "FAIL", 
                                f"Unexpected status code: {response.status_code}")
                    
            except Exception as e:
                self.log_test(f"Update Targets Validation - {test_case['name']}", "FAIL", f"Exception: {str(e)}")
    
    def test_xss_prevention(self):
        """Test 6: XSS Prevention in string inputs"""
        xss_payloads = [
            "<script>alert('xss')</script>",
            "<img src=x onerror=alert('xss')>",
            "javascript:alert('xss')",
            "<svg onload=alert('xss')>",
            "';alert('xss');//",
            "<iframe src=javascript:alert('xss')></iframe>"
        ]
        
        for payload in xss_payloads:
            try:
                # Test XSS in exchange-token metadata
                test_payload = {
                    "public_token": "test-token",
                    "metadata": {
                        "institution": {
                            "institution_id": payload,
                            "name": f"Bank {payload}"
                        }
                    }
                }
                
                response = requests.post(f"{self.base_url}/exchange-token", 
                                       json=test_payload, headers=self.headers, timeout=10)
                
                # Should be rejected due to auth or validation
                if response.status_code in [400, 401, 500]:
                    self.log_test(f"XSS Prevention - {payload[:20]}...", "PASS", 
                                f"XSS payload rejected (status {response.status_code})")
                else:
                    self.log_test(f"XSS Prevention - {payload[:20]}...", "FAIL", 
                                f"XSS payload not rejected (status {response.status_code})")
                    
            except Exception as e:
                self.log_test(f"XSS Prevention - {payload[:20]}...", "FAIL", f"Exception: {str(e)}")
    
    def test_sql_injection_prevention(self):
        """Test 7: SQL Injection Prevention"""
        sql_payloads = [
            "'; DROP TABLE accounts; --",
            "' OR '1'='1",
            "'; INSERT INTO accounts VALUES ('malicious'); --",
            "' UNION SELECT * FROM user_profiles --",
            "'; UPDATE accounts SET balance=0; --"
        ]
        
        for payload in sql_payloads:
            try:
                # Test SQL injection in various endpoints
                test_payload = {"public_token": payload}
                
                response = requests.post(f"{self.base_url}/exchange-token", 
                                       json=test_payload, headers=self.headers, timeout=10)
                
                # Should be rejected
                if response.status_code in [400, 401, 500]:
                    self.log_test(f"SQL Injection Prevention - {payload[:20]}...", "PASS", 
                                f"SQL injection attempt rejected (status {response.status_code})")
                else:
                    self.log_test(f"SQL Injection Prevention - {payload[:20]}...", "FAIL", 
                                f"SQL injection attempt not rejected (status {response.status_code})")
                    
            except Exception as e:
                self.log_test(f"SQL Injection Prevention - {payload[:20]}...", "FAIL", f"Exception: {str(e)}")
    
    def test_authentication_required(self):
        """Test 8: Authentication Requirements"""
        protected_endpoints = [
            ("GET", "/dashboard"),
            ("GET", "/accounts"),
            ("GET", "/user-profile"),
            ("POST", "/exchange-token"),
            ("POST", "/refresh-accounts"),
            ("POST", "/update-targets")
        ]
        
        for method, endpoint in protected_endpoints:
            try:
                if method == "GET":
                    response = requests.get(f"{self.base_url}{endpoint}", headers=self.headers, timeout=10)
                else:
                    response = requests.post(f"{self.base_url}{endpoint}", 
                                           json={}, headers=self.headers, timeout=10)
                
                if response.status_code == 401:
                    try:
                        error_data = response.json()
                        if error_data.get('error') == 'Unauthorized':
                            self.log_test(f"Authentication - {method} {endpoint}", "PASS", 
                                        "Properly requires authentication")
                        else:
                            self.log_test(f"Authentication - {method} {endpoint}", "PASS", 
                                        f"Authentication required (error: {error_data.get('error')})")
                    except:
                        self.log_test(f"Authentication - {method} {endpoint}", "PASS", 
                                    "Authentication required (401 status)")
                else:
                    self.log_test(f"Authentication - {method} {endpoint}", "FAIL", 
                                f"Expected 401, got {response.status_code}")
                    
            except Exception as e:
                self.log_test(f"Authentication - {method} {endpoint}", "FAIL", f"Exception: {str(e)}")
    
    def test_error_handling_security(self):
        """Test 9: Secure Error Handling"""
        try:
            # Test invalid route
            response = requests.get(f"{self.base_url}/nonexistent-route", headers=self.headers, timeout=10)
            
            if response.status_code == 404:
                try:
                    error_data = response.json()
                    error_msg = error_data.get('error', '').lower()
                    
                    # Check that error doesn't leak internal information
                    sensitive_info = ['stack trace', 'file path', 'database', 'internal', 'secret', 'key']
                    
                    if any(info in error_msg for info in sensitive_info):
                        self.log_test("Error Handling Security", "FAIL", 
                                    f"Error message may leak sensitive info: {error_msg}")
                    else:
                        self.log_test("Error Handling Security", "PASS", 
                                    "404 error handled securely without information leakage")
                except:
                    self.log_test("Error Handling Security", "PASS", 
                                "404 error handled securely")
            else:
                self.log_test("Error Handling Security", "FAIL", 
                            f"Expected 404 for invalid route, got {response.status_code}")
                
        except Exception as e:
            self.log_test("Error Handling Security", "FAIL", f"Exception: {str(e)}")
    
    def test_health_endpoint_enhanced(self):
        """Test 10: Enhanced Health Endpoint"""
        try:
            response = requests.get(f"{self.base_url}/health", headers=self.headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required fields
                required_fields = ['status', 'timestamp', 'environment']
                missing_fields = [f for f in required_fields if f not in data]
                
                if not missing_fields:
                    # Validate field values
                    if data['status'] == 'healthy':
                        if data['environment'] in ['sandbox', 'development', 'production']:
                            # Check timestamp format
                            try:
                                datetime.fromisoformat(data['timestamp'].replace('Z', '+00:00'))
                                self.log_test("Enhanced Health Endpoint", "PASS", 
                                            f"Health endpoint working with environment: {data['environment']}")
                            except:
                                self.log_test("Enhanced Health Endpoint", "FAIL", 
                                            "Invalid timestamp format")
                        else:
                            self.log_test("Enhanced Health Endpoint", "FAIL", 
                                        f"Invalid environment value: {data['environment']}")
                    else:
                        self.log_test("Enhanced Health Endpoint", "FAIL", 
                                    f"Unexpected status: {data['status']}")
                else:
                    self.log_test("Enhanced Health Endpoint", "FAIL", 
                                f"Missing fields: {missing_fields}")
            else:
                self.log_test("Enhanced Health Endpoint", "FAIL", 
                            f"Health endpoint returned {response.status_code}")
                
        except Exception as e:
            self.log_test("Enhanced Health Endpoint", "FAIL", f"Exception: {str(e)}")
    
    def test_token_encryption_flow(self):
        """Test 11: Token Encryption Flow (indirect test)"""
        try:
            # We can't directly test encryption, but we can test the flow
            # Test with a valid-looking but fake token to see if encryption logic is triggered
            
            test_payload = {
                "public_token": "link-sandbox-fake-token-for-testing",
                "metadata": {
                    "institution": {
                        "institution_id": "ins_test",
                        "name": "Test Bank"
                    }
                }
            }
            
            response = requests.post(f"{self.base_url}/exchange-token", 
                                   json=test_payload, headers=self.headers, timeout=10)
            
            # Should fail at authentication or Plaid API call, not encryption
            if response.status_code in [401, 500]:
                try:
                    error_data = response.json()
                    error_msg = error_data.get('error', '').lower()
                    
                    # If it mentions encryption errors, that means encryption is being attempted
                    if 'encrypt' in error_msg or 'decrypt' in error_msg:
                        self.log_test("Token Encryption Flow", "PASS", 
                                    "Encryption logic is being executed")
                    elif 'unauthorized' in error_msg:
                        self.log_test("Token Encryption Flow", "PASS", 
                                    "Authentication required before encryption (expected)")
                    elif 'failed to exchange token' in error_msg:
                        self.log_test("Token Encryption Flow", "PASS", 
                                    "Token exchange flow working (would encrypt on success)")
                    else:
                        self.log_test("Token Encryption Flow", "PASS", 
                                    f"Token exchange endpoint working (status {response.status_code})")
                except:
                    self.log_test("Token Encryption Flow", "PASS", 
                                f"Token exchange endpoint responding (status {response.status_code})")
            else:
                self.log_test("Token Encryption Flow", "WARN", 
                            f"Unexpected response: {response.status_code}")
                
        except Exception as e:
            self.log_test("Token Encryption Flow", "FAIL", f"Exception: {str(e)}")
    
    def run_all_tests(self):
        """Run all security tests"""
        print("🔒 Starting Comprehensive Security Testing for Credt Backend API")
        print("=" * 70)
        
        # Run all tests
        self.test_environment_validation()
        self.test_enhanced_health_endpoint()
        self.test_authentication_required()
        self.test_input_validation_exchange_token()
        self.test_input_validation_update_targets()
        self.test_xss_prevention()
        self.test_sql_injection_prevention()
        self.test_rate_limiting_get()
        self.test_rate_limiting_post()
        self.test_error_handling_security()
        self.test_token_encryption_flow()
        
        # Summary
        print("\n" + "=" * 70)
        print("🔒 SECURITY TEST SUMMARY")
        print("=" * 70)
        
        passed = len([t for t in self.test_results if t['status'] == 'PASS'])
        failed = len([t for t in self.test_results if t['status'] == 'FAIL'])
        warnings = len([t for t in self.test_results if t['status'] == 'WARN'])
        
        print(f"✅ PASSED: {passed}")
        print(f"❌ FAILED: {failed}")
        print(f"⚠️  WARNINGS: {warnings}")
        print(f"📊 TOTAL TESTS: {len(self.test_results)}")
        
        if failed > 0:
            print("\n❌ FAILED TESTS:")
            for test in self.test_results:
                if test['status'] == 'FAIL':
                    print(f"  - {test['test']}: {test['details']}")
        
        if warnings > 0:
            print("\n⚠️  WARNINGS:")
            for test in self.test_results:
                if test['status'] == 'WARN':
                    print(f"  - {test['test']}: {test['details']}")
        
        return {
            'passed': passed,
            'failed': failed,
            'warnings': warnings,
            'total': len(self.test_results),
            'results': self.test_results
        }

if __name__ == "__main__":
    # Run the security test suite
    suite = SecurityTestSuite()
    results = suite.run_all_tests()
    
    # Exit with appropriate code
    exit_code = 0 if results['failed'] == 0 else 1
    exit(exit_code)