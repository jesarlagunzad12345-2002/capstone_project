const ADDON_PRICES = {
  poolAdult: 150,
  poolChild: 100,
  ktv: 1000
};
const EXTRA_OVERNIGHT_GUEST_PRICE = 200;
const ENTRANCE_FEE_PER_PERSON = 30;
const MAX_BOOKING_GUESTS = 20;

function normalizeBookingAddons(body, guestCount, maxPaidPoolUsers = guestCount) {
  const selected = Array.isArray(body.addons)
    ? body.addons
    : body.addons
      ? [body.addons]
      : [];
  const wantsPool = selected.includes("pool");
  const wantsKtv = selected.includes("ktv");
  const adultCount = Number(body.poolAdultCount || 0);
  const childCount = Number(body.poolChildCount || 0);
  const ktvGuestCount = wantsKtv
    ? Number(body.ktvGuestCount || Math.min(guestCount, 15))
    : 0;

  if (!Number.isInteger(adultCount) || adultCount < 0 ||
      !Number.isInteger(childCount) || childCount < 0) {
    return { error: "Pool guest counts must be whole, non-negative numbers." };
  }

  if (wantsPool && adultCount + childCount < 1) {
    return { error: "Enter the number of adults and children using the pool." };
  }

  if (wantsPool && adultCount + childCount > maxPaidPoolUsers) {
    return { error: `Pool users cannot exceed the ${maxPaidPoolUsers} guests eligible for paid pool access.` };
  }

  if (wantsKtv && (!Number.isInteger(ktvGuestCount) || ktvGuestCount < 1 ||
      ktvGuestCount > 15 || ktvGuestCount > guestCount)) {
    return { error: `KTV guest count must be between 1 and ${Math.min(guestCount, 15)}.` };
  }

  const poolFee = wantsPool ? adultCount * ADDON_PRICES.poolAdult + childCount * ADDON_PRICES.poolChild : 0;
  const ktvFee = wantsKtv ? ADDON_PRICES.ktv : 0;
  const price = poolFee + ktvFee;
  const descriptions = [];

  if (wantsPool) {
    descriptions.push(
      `Swimming pool (${adultCount} adult${adultCount === 1 ? "" : "s"}; ${childCount} child${childCount === 1 ? "" : "ren"} under 4 ft)`
    );
  }
  if (wantsKtv) {
    descriptions.push("KTV room (3 hours, up to 15 guests)");
  }

  return {
    price,
    poolFee,
    ktvFee,
    poolSelected: wantsPool,
    ktvSelected: wantsKtv,
    poolAdultCount: wantsPool ? adultCount : 0,
    poolChildCount: wantsPool ? childCount : 0,
    ktvGuestCount,
    descriptions
  };
}

function appendAddonRequests(requests, addonDescriptions) {
  const notes = String(requests || "")
    .split(/\r?\n/)
    .filter(line => !line.startsWith("Optional add-ons:"))
    .join("\n")
    .trim();
  if (addonDescriptions.length === 0) return notes || null;

  const addonNote = `Optional add-ons: ${addonDescriptions.join("; ")}`;
  return notes ? `${notes}\n${addonNote}` : addonNote;
}

function getBookingAddonsFromRequests(requests) {
  const addonLine = String(requests || "")
    .split(/\r?\n/)
    .find(line => line.startsWith("Optional add-ons:"));
  if (!addonLine) {
    return { poolSelected: false, poolAdultCount: 0, poolChildCount: 0, ktvSelected: false, ktvGuestCount: 0 };
  }
  const poolMatch = addonLine.match(/Swimming pool \((\d+) adults?; (\d+) child(?:ren)? under 4 ft\)/i);
  return {
    poolSelected: Boolean(poolMatch),
    poolAdultCount: poolMatch ? Number(poolMatch[1]) : 0,
    poolChildCount: poolMatch ? Number(poolMatch[2]) : 0,
    ktvSelected: /KTV room \(3 hours, up to 15 guests\)/i.test(addonLine),
    ktvGuestCount: 0
  };
}

function getBookingAddons(booking) {
  const parsed = getBookingAddonsFromRequests(booking && booking.requests);
  return {
    poolSelected: Boolean(Number(booking && booking.pool_addon)) || parsed.poolSelected,
    poolAdultCount: Number(booking && booking.pool_adult_count) || parsed.poolAdultCount,
    poolChildCount: Number(booking && booking.pool_child_count) || parsed.poolChildCount,
    ktvSelected: Boolean(Number(booking && booking.ktv_addon)) || parsed.ktvSelected,
    ktvGuestCount: Boolean(Number(booking && booking.ktv_addon)) || parsed.ktvSelected
      ? Math.min(
        15,
        Number(booking && booking.ktv_guest_count) || Number(booking && booking.people) || 1
      )
      : 0
  };
}

function stripCalculatedBookingRequests(requests) {
  const remaining = String(requests || "")
    .split(/\r?\n/)
    .filter(line =>
      !line.startsWith("Optional add-ons:") &&
      !line.startsWith("Overnight extra guests:") &&
      !line.startsWith("Entrance fee:")
    )
    .join("\n")
    .trim();
  return remaining || null;
}

function getBookingAddonPriceFromRequests(requests) {
  const addonLine = String(requests || "")
    .split(/\r?\n/)
    .find(line => line.startsWith("Optional add-ons:"));
  if (!addonLine) return 0;

  const poolMatch = addonLine.match(/Swimming pool \((\d+) adults?; (\d+) child(?:ren)? under 4 ft\)/i);
  const poolPrice = poolMatch
    ? Number(poolMatch[1]) * ADDON_PRICES.poolAdult + Number(poolMatch[2]) * ADDON_PRICES.poolChild
    : 0;
  const ktvPrice = /KTV room \(3 hours, up to 15 guests\)/i.test(addonLine) ? ADDON_PRICES.ktv : 0;
  return poolPrice + ktvPrice;
}

function capPaidPoolAddonRequest(requests, maxPaidPoolUsers) {
  const prefix = "Optional add-ons:";
  return String(requests || "")
    .split(/\r?\n/)
    .map(line => {
      if (!line.startsWith(prefix)) return line;

      const poolPattern = /Swimming pool \((\d+) adults?; (\d+) child(?:ren)? under 4 ft\)/i;
      const poolMatch = line.match(poolPattern);
      const remainingDescriptions = line
        .slice(prefix.length)
        .replace(poolPattern, "")
        .split(";")
        .map(description => description.trim())
        .filter(Boolean);
      if (poolMatch) {
        const adults = Math.min(Number(poolMatch[1]), maxPaidPoolUsers);
        const children = Math.min(Number(poolMatch[2]), Math.max(0, maxPaidPoolUsers - adults));
        if (adults + children > 0) {
          remainingDescriptions.unshift(
            `Swimming pool (${adults} adult${adults === 1 ? "" : "s"}; ${children} child${children === 1 ? "" : "ren"} under 4 ft)`
          );
        }
      }
      return remainingDescriptions.length ? `${prefix} ${remainingDescriptions.join("; ")}` : "";
    })
    .filter(Boolean)
    .join("\n") || null;
}

function getOvernightExtraGuestFee(guestCount, includedOccupancy, nights) {
  const extraGuestCount = Math.max(0, guestCount - includedOccupancy);
  return extraGuestCount * EXTRA_OVERNIGHT_GUEST_PRICE * nights;
}

function getEntranceFee(guestCount, isCottage = true) {
  return isCottage ? guestCount * ENTRANCE_FEE_PER_PERSON : 0;
}

function appendEntranceFeeRequest(requests, guestCount, isCottage = true) {
  const notes = String(requests || "")
    .split(/\r?\n/)
    .filter(line => !line.startsWith("Entrance fee:"))
    .join("\n")
    .trim();
  if (!isCottage) return notes || null;
  const feeNote = `Entrance fee: ${guestCount} guest${guestCount === 1 ? "" : "s"} × ₱${ENTRANCE_FEE_PER_PERSON} = ₱${getEntranceFee(guestCount).toLocaleString("en-PH")}`;
  return notes ? `${notes}\n${feeNote}` : feeNote;
}

function appendOvernightExtraGuestRequest(requests, extraGuestCount, nights) {
  const notes = String(requests || "")
    .split(/\r?\n/)
    .filter(line => !line.startsWith("Overnight extra guests:"))
    .join("\n")
    .trim();

  if (extraGuestCount < 1 || nights < 1) return notes || null;

  const fee = extraGuestCount * EXTRA_OVERNIGHT_GUEST_PRICE * nights;
  const feeNote = `Overnight extra guests: ${extraGuestCount} × ₱${EXTRA_OVERNIGHT_GUEST_PRICE} × ${nights} night${nights === 1 ? "" : "s"} = ₱${fee.toLocaleString("en-PH")}`;
  return notes ? `${notes}\n${feeNote}` : feeNote;
}

module.exports = {
  normalizeBookingAddons,
  appendAddonRequests,
  getBookingAddonsFromRequests,
  getBookingAddons,
  stripCalculatedBookingRequests,
  getBookingAddonPriceFromRequests,
  capPaidPoolAddonRequest,
  getOvernightExtraGuestFee,
  getEntranceFee,
  appendEntranceFeeRequest,
  appendOvernightExtraGuestRequest,
  EXTRA_OVERNIGHT_GUEST_PRICE,
  ENTRANCE_FEE_PER_PERSON,
  MAX_BOOKING_GUESTS
};
