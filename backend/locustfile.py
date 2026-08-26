from locust import HttpUser, between, task


class RouteUser(HttpUser):
    wait_time = between(0.1, 0.5)

    @task
    def route_query(self):
        self.client.post(
            "/route",
            json={
                "start": {"lat": 33.4228, "lon": -111.9336},
                "end": {"lat": 33.4213, "lon": -111.9302},
                "time_of_day": 12,
                "day_of_year": 180,
                "optimize_for": "shade",
                "shade_weight": 0.7,
            },
        )
