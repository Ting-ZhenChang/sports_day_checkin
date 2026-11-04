class ApiError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const api = (() => {
  async function request(path, method = "GET", body) {
    let response;

    try {
      response = await fetch(`/api${path}`, {
        method,
        headers: body === undefined
          ? {}
          : { "Content-Type": "application/json" },
        body: body === undefined
          ? undefined
          : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new ApiError("NETWORK_ERROR");
    }

    const data = await response.json();

    if (!response.ok) {
      const { code = "INVALID_REQUEST", ...extra } = data;
      throw new ApiError(code, extra);
    }

    return data;
  }

  return {
    lookupBySeed: seed =>
      request(`/employee/by-seed/${encodeURIComponent(seed)}`),
    listRecords: () => request("/records"),
    checkIn: body => request("/checkin", "POST", body),
    confirmClaim: (seed, expectedRelatives) =>
      request("/claim", "POST", { seed, expectedRelatives }),
    signReceipt: body =>
      request("/receipt/sign", "POST", body),
    updateRelatives: ({ empId, ...body }) =>
      request(
        `/checkin/${encodeURIComponent(empId)}/relatives`,
        "PUT",
        body
      ),
    registerWalkIn: body =>
      request("/walk-in", "POST", body),
  };
})();

document.getElementById("resetBtn")?.setAttribute("hidden", "");