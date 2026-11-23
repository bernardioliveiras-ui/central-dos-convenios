// Tarifa inteiramente fictícia, utilizada somente em apresentações.
const DEMO_BASE={saude:[189,269,439,690],odontologico:[29,39,59,79],pet:[45,65,85,105]};

export function estimateDemoPlan(category,ageBand,count){
  const bands=DEMO_BASE[category];
  if(!bands||!Number.isInteger(ageBand)||ageBand<0||ageBand>3||!Number.isInteger(count)||count<1||count>10)throw Error('Cenário demonstrativo inválido.');
  const monthly=Number((bands[ageBand]*count*(count>=3?0.95:1)).toFixed(2));
  return {monthly,annual:Number((monthly*12).toFixed(2)),fictitious:true};
}
