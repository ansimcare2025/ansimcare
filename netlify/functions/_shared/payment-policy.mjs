// 주문 신청/관리자 수납확인 상태만 담당합니다. 실제 카드 결제 및 PG 승인 기능이 아닙니다.
export const MONTH_OPTIONS=Object.freeze([1,3,6,12]);
export const ORDER_PENDING='awaiting_manual_review';
export const ORDER_PAID='manually_verified';
export const ORDER_CANCELED='canceled';
export function invoiceAmount(months,monthlyPrice){
 if(!MONTH_OPTIONS.includes(months)||!Number.isSafeInteger(monthlyPrice)||monthlyPrice<0)throw Error('기간 또는 요금이 유효하지 않습니다.');
 const value=months*monthlyPrice;
 if(!Number.isSafeInteger(value)||value>1000000000)throw Error('금액이 계산 범위를 초과했습니다.');
 return value;
}
export function normalizeOrderMonths(value){
 const months=Number(value);
 if(!MONTH_OPTIONS.includes(months))throw Error('1·3·6·12개월 중 하나를 선택하세요.');
 return months;
}
export function providerOrderView(o){
 return {id:o.id,facilityId:o.facilityId,facilityName:o.facilityName,facilityType:o.facilityType,region:o.region,district:o.district,months:o.months,monthlyPrice:o.monthlyPrice,estimatedAmount:o.estimatedAmount,requestDate:o.requestDate,status:o.status,method:o.method,reviewedDate:o.reviewedDate||'',note:o.note||''};
}
