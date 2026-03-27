"""
Auth + Plan CRUD + Sharing integration tests.
Full flow: register → login → me → plans → share → delete.
"""
import pytest
import time


class TestRegistration:
    def test_register_new_user(self, client):
        res = client.post("/auth/register", json={
            "email": "new@test.com",
            "password": "pass123",
            "display_name": "New User",
        })
        assert res.status_code == 200
        data = res.json()
        assert "token" in data
        assert data["user"]["email"] == "new@test.com"
        assert data["user"]["display_name"] == "New User"

    def test_duplicate_email_rejected(self, client):
        client.post("/auth/register", json={
            "email": "dup@test.com", "password": "pass123",
        })
        res = client.post("/auth/register", json={
            "email": "dup@test.com", "password": "other123",
        })
        assert res.status_code == 400
        assert "already registered" in res.json()["detail"].lower()

    def test_short_password_rejected(self, client):
        res = client.post("/auth/register", json={
            "email": "short@test.com", "password": "abc",
        })
        assert res.status_code == 400
        assert "6 characters" in res.json()["detail"]

    def test_register_creates_default_plan(self, auth_client):
        res = auth_client.get("/plans")
        assert res.status_code == 200
        plans = res.json()
        assert len(plans) == 1
        assert plans[0]["name"] == "My Plan"
        assert plans[0]["is_default"] is True


class TestLogin:
    def test_login_valid_credentials(self, client):
        client.post("/auth/register", json={
            "email": "login@test.com", "password": "pass123",
        })
        res = client.post("/auth/login", json={
            "email": "login@test.com", "password": "pass123",
        })
        assert res.status_code == 200
        assert "token" in res.json()

    def test_wrong_password(self, client):
        client.post("/auth/register", json={
            "email": "wrong@test.com", "password": "pass123",
        })
        res = client.post("/auth/login", json={
            "email": "wrong@test.com", "password": "wrongpass",
        })
        assert res.status_code == 401

    def test_nonexistent_email(self, client):
        res = client.post("/auth/login", json={
            "email": "ghost@test.com", "password": "pass123",
        })
        assert res.status_code == 401

    def test_email_case_insensitive(self, client):
        client.post("/auth/register", json={
            "email": "Case@Test.com", "password": "pass123",
        })
        res = client.post("/auth/login", json={
            "email": "case@test.com", "password": "pass123",
        })
        assert res.status_code == 200


class TestGetMe:
    def test_get_me_with_token(self, auth_client):
        res = auth_client.get("/auth/me")
        assert res.status_code == 200
        data = res.json()
        assert data["email"] == "test@example.com"
        assert data["display_name"] == "Test User"

    def test_get_me_without_token(self, client):
        res = client.get("/auth/me")
        assert res.status_code in (401, 403)

    def test_get_me_with_bad_token(self, client):
        res = client.get("/auth/me", headers={
            "Authorization": "Bearer invalid-token-here",
        })
        assert res.status_code in (401, 403)


class TestPlanCRUD:
    def test_create_plan(self, auth_client):
        res = auth_client.post("/plans", json={"name": "Test Plan"})
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Test Plan"
        assert "inputs" in data

    def test_list_plans(self, auth_client):
        auth_client.post("/plans", json={"name": "Plan A"})
        auth_client.post("/plans", json={"name": "Plan B"})
        res = auth_client.get("/plans")
        assert res.status_code == 200
        plans = res.json()
        assert len(plans) >= 3  # default + 2 new

    def test_get_specific_plan(self, auth_client):
        create_res = auth_client.post("/plans", json={"name": "Specific"})
        plan_id = create_res.json()["id"]
        res = auth_client.get(f"/plans/{plan_id}")
        assert res.status_code == 200
        assert res.json()["name"] == "Specific"

    def test_update_plan_name(self, auth_client):
        create_res = auth_client.post("/plans", json={"name": "Old Name"})
        plan_id = create_res.json()["id"]
        res = auth_client.put(f"/plans/{plan_id}", json={"name": "New Name"})
        assert res.status_code == 200
        assert res.json()["name"] == "New Name"

    def test_update_plan_inputs(self, auth_client):
        create_res = auth_client.post("/plans", json={"name": "Input Test"})
        plan_id = create_res.json()["id"]
        new_inputs = {"retire_age": 55, "inflation": 0.03}
        res = auth_client.put(f"/plans/{plan_id}", json={"inputs": new_inputs})
        assert res.status_code == 200
        assert res.json()["inputs"]["retire_age"] == 55

    def test_delete_plan(self, auth_client):
        # Create a second plan (can't delete the only one)
        auth_client.post("/plans", json={"name": "To Delete"})
        plans = auth_client.get("/plans").json()
        to_delete = next(p for p in plans if p["name"] == "To Delete")
        res = auth_client.delete(f"/plans/{to_delete['id']}")
        assert res.status_code == 200
        assert res.json()["deleted"] is True

    def test_cannot_delete_only_plan(self, auth_client):
        plans = auth_client.get("/plans").json()
        assert len(plans) == 1
        res = auth_client.delete(f"/plans/{plans[0]['id']}")
        assert res.status_code == 400
        assert "only plan" in res.json()["detail"].lower()

    def test_max_10_plans(self, auth_client):
        # Already have 1 default plan, create 9 more
        for i in range(9):
            res = auth_client.post("/plans", json={"name": f"Plan {i}"})
            assert res.status_code == 200
        # 11th should fail
        res = auth_client.post("/plans", json={"name": "Too Many"})
        assert res.status_code == 400
        assert "10" in res.json()["detail"]


class TestSharing:
    def test_share_plan(self, auth_client):
        plans = auth_client.get("/plans").json()
        plan_id = plans[0]["id"]
        res = auth_client.post(f"/plans/{plan_id}/share")
        assert res.status_code == 200
        data = res.json()
        assert "token" in data
        assert "url" in data

    def test_view_shared_plan(self, auth_client):
        plans = auth_client.get("/plans").json()
        plan_id = plans[0]["id"]
        share_res = auth_client.post(f"/plans/{plan_id}/share")
        token = share_res.json()["token"]

        # View without auth
        res = auth_client.client.get(f"/shared/{token}")
        assert res.status_code == 200
        data = res.json()
        assert "plan_name" in data
        assert "simulation" in data
        assert "monthly" in data["simulation"]
        assert "yearly" in data["simulation"]

    def test_shared_view_increments_counter(self, auth_client):
        plans = auth_client.get("/plans").json()
        plan_id = plans[0]["id"]
        share_res = auth_client.post(f"/plans/{plan_id}/share")
        token = share_res.json()["token"]

        auth_client.client.get(f"/shared/{token}")
        auth_client.client.get(f"/shared/{token}")
        res = auth_client.client.get(f"/shared/{token}")
        assert res.json()["views"] == 3

    def test_invalid_share_token(self, client):
        res = client.get("/shared/nonexistent-token")
        assert res.status_code == 404

    def test_share_idempotent(self, auth_client):
        """Sharing the same plan twice returns the same token."""
        plans = auth_client.get("/plans").json()
        plan_id = plans[0]["id"]
        res1 = auth_client.post(f"/plans/{plan_id}/share")
        res2 = auth_client.post(f"/plans/{plan_id}/share")
        assert res1.json()["token"] == res2.json()["token"]


class TestSimulateWithPlan:
    def test_simulate_saved_plan(self, auth_client):
        plans = auth_client.get("/plans").json()
        plan_id = plans[0]["id"]
        res = auth_client.post(f"/plans/{plan_id}/simulate")
        assert res.status_code == 200
        data = res.json()
        assert len(data["monthly"]) == 523
        assert data["metadata"]["plan_id"] == plan_id
