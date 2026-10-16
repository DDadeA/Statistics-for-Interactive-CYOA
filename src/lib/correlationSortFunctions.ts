import type { correlationObject } from './types';

// Correlation Helper Functions
const getProbAB = (obj: correlationObject) => obj.percent / 100;

const calcJaccard = (obj: correlationObject) => {
	const pAB = getProbAB(obj);
	const union = obj.probA + obj.probB - pAB;
	return union <= 0 ? 0 : pAB / union;
};
const calcCosine = (obj: correlationObject) => {
	const pAB = getProbAB(obj);
	const denom = Math.sqrt(obj.probA * obj.probB);
	return denom <= 0 ? 0 : pAB / denom;
};
const calcLogWeightedLift = (obj: correlationObject) => {
	return obj.lift * Math.log(obj.count + 1);
};
export const correlationSortFunctions = [
	{
		label: 'Log-Weighted Lift (Balanced Heuristic)',
		value: (a: correlationObject, b: correlationObject) =>
			calcLogWeightedLift(b) - calcLogWeightedLift(a)
	},
	{
		label: 'Jaccard Index (Intersection over Union)',
		value: (a: correlationObject, b: correlationObject) => calcJaccard(b) - calcJaccard(a)
	},
	{
		label: 'Cosine Similarity',
		value: (a: correlationObject, b: correlationObject) => calcCosine(b) - calcCosine(a)
	},
	{
		label: 'Frequency-weighted Lift',
		value: (a: correlationObject, b: correlationObject) => b.lift * b.count - a.lift * a.count
	},
	{
		label: 'Lift (Basic Probability Ratio)',
		value: (a: correlationObject, b: correlationObject) => b.lift - a.lift
	},
	{
		label: 'Co-Occurrence Percentage',
		value: (a: correlationObject, b: correlationObject) => b.percent - a.percent
	},
	{
		label: 'Co-Occurrence Count',
		value: (a: correlationObject, b: correlationObject) => b.count - a.count
	}
];
